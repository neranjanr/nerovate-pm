"""Reminder anchored core (01, one-time).

Endpoints (all membership-gated, 404 avoids enumeration):
  POST   /api/v1/reminders
  GET    /api/v1/reminders?project_id&task_id&status
  GET    /api/v1/reminders/mine (active by default)
  GET    /api/v1/reminders/{id}
  PATCH  /api/v1/reminders/{id}
  POST   /api/v1/reminders/{id}/done
  POST   /api/v1/reminders/{id}/dismiss
  DELETE /api/v1/reminders/{id}

Permissions mirror the Task edit gate: any write needs project access
(union membership, admin bypass) plus non-guest role. Reads additionally
admit the anchor Task Assignee / Watchers, the anchor Project Owner, and
the creator so the "visible to Assignee, Watchers, and Project Owners"
acceptance holds even without direct membership.
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlmodel import Session, select

from app.auth.models import User
from app.deps import get_current_user, get_session
from app.projects.router import require_project_access
from app.reminders.models import Reminder

router = APIRouter(prefix="/api/v1/reminders", tags=["reminders"])

REMINDER_STATUSES = ("active", "done", "dismissed")


class ReminderCreate(BaseModel):
    title: str
    note: str = ""
    due_at: str
    project_id: int | None = None
    task_id: int | None = None


class ReminderUpdate(BaseModel):
    title: str | None = None
    note: str | None = None
    due_at: str | None = None
    status: str | None = None
    project_id: int | None = None
    task_id: int | None = None


class ReminderOut(BaseModel):
    id: int
    title: str
    note: str = ""
    due_at: str
    status: str
    project_id: int | None = None
    task_id: int | None = None
    anchor_project_id: int | None = None
    anchor_title: str | None = None
    created_by: int | None = None
    created_at: str
    updated_at: str


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _validate_status(value: str) -> str:
    v = (value or "").strip().lower()
    if v not in REMINDER_STATUSES:
        raise HTTPException(status_code=422, detail="Invalid status (active|done|dismissed)")
    return v


def _validate_anchor(project_id: int | None, task_id: int | None) -> None:
    has_project = project_id is not None
    has_task = task_id is not None
    if has_project == has_task:
        raise HTTPException(
            status_code=422, detail="Exactly one of project_id, task_id is required"
        )


def _resolve_anchor_project_id(
    session: Session, project_id: int | None, task_id: int | None
) -> int:
    """Return the owning project id for an anchor; 404 when anchor missing."""
    from app.projects.models import Project
    from app.tasks.models import Task

    if task_id is not None:
        task = session.get(Task, task_id)
        if task is None:
            raise HTTPException(status_code=404, detail="Not found")
        return task.project_id
    assert project_id is not None
    project = session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Not found")
    return project.id  # type: ignore[return-value]


def _require_write_on_project(project_id: int, current: User, session: Session) -> None:
    require_project_access(project_id, current, session)
    if current.role == "guest":
        raise HTTPException(status_code=403, detail="Guest is read-only")


def _can_see(session: Session, reminder: Reminder, user: User) -> bool:
    """Read gate: project union membership, else anchor roles."""
    assert reminder.id is not None
    assert user.id is not None
    if user.role == "admin":
        return True
    anchor_pid: int | None = None
    if reminder.task_id is not None:
        from app.tasks.models import Task

        task = session.get(Task, reminder.task_id)
        if task is None:
            # Anchor row gone (pre-03 detach): creator + admins retain sight.
            return reminder.created_by == user.id
        anchor_pid = task.project_id
    elif reminder.project_id is not None:
        anchor_pid = reminder.project_id
    if anchor_pid is not None:
        try:
            require_project_access(anchor_pid, user, session)
            return True
        except HTTPException:
            pass
        # Anchor Task Assignee / Watchers see it without membership.
        if reminder.task_id is not None:
            from app.tasks.models import TaskAssignee, TaskWatcher

            if session.get(TaskAssignee, (reminder.task_id, user.id)) is not None:
                return True
            if session.get(TaskWatcher, (reminder.task_id, user.id)) is not None:
                return True
        # Anchor Project Owner + creator see it without membership.
        try:
            from app.projects.models import Project

            proj = session.get(Project, anchor_pid)
            if proj is not None and proj.owner_id == user.id:
                return True
        except Exception:
            pass
        if reminder.created_by == user.id:
            return True
    return False


def _require_visible(session: Session, reminder: Reminder, user: User) -> None:
    if not _can_see(session, reminder, user):
        raise HTTPException(status_code=404, detail="Not found")


def _out(reminder: Reminder, session: Session) -> ReminderOut:
    assert reminder.id is not None
    anchor_pid: int | None = None
    anchor_title: str | None = None
    if reminder.task_id is not None:
        from app.tasks.models import Task

        task = session.get(Task, reminder.task_id)
        if task is not None:
            anchor_pid = task.project_id
            anchor_title = task.title
    elif reminder.project_id is not None:
        from app.projects.models import Project

        anchor_pid = reminder.project_id
        proj = session.get(Project, reminder.project_id)
        anchor_title = proj.name if proj is not None else None
    return ReminderOut(
        id=reminder.id,
        title=reminder.title,
        note=reminder.note,
        due_at=reminder.due_at,
        status=reminder.status,
        project_id=reminder.project_id,
        task_id=reminder.task_id,
        anchor_project_id=anchor_pid,
        anchor_title=anchor_title,
        created_by=reminder.created_by,
        created_at=reminder.created_at,
        updated_at=reminder.updated_at,
    )


def _visible_reminders(session: Session, user: User) -> list[Reminder]:
    rows = session.exec(select(Reminder)).all()
    visible = [r for r in rows if _can_see(session, r, user)]
    visible.sort(key=lambda r: (r.due_at or "", r.id or 0))
    return visible


@router.post("", response_model=ReminderOut, status_code=status.HTTP_201_CREATED)
def create_reminder(
    body: ReminderCreate,
    current: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    title = (body.title or "").strip()
    if not title:
        raise HTTPException(status_code=422, detail="Title required")
    due_at = (body.due_at or "").strip()
    if not due_at:
        raise HTTPException(status_code=422, detail="due_at required")
    _validate_anchor(body.project_id, body.task_id)
    anchor_pid = _resolve_anchor_project_id(session, body.project_id, body.task_id)
    _require_write_on_project(anchor_pid, current, session)
    assert current.id is not None
    reminder = Reminder(
        title=title[:256],
        note=(body.note or "")[:2000],
        due_at=due_at[:32],
        status="active",
        project_id=body.project_id,
        task_id=body.task_id,
        created_by=current.id,
    )
    session.add(reminder)
    session.commit()
    session.refresh(reminder)
    return _out(reminder, session)


@router.get("/mine", response_model=list[ReminderOut])
def my_reminders(
    status_filter: str | None = Query(default=None, alias="status"),
    current: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    wanted = "active"
    if status_filter is not None:
        wanted = _validate_status(status_filter)
    rows = [r for r in _visible_reminders(session, current) if r.status == wanted]
    return [_out(r, session) for r in rows]


@router.get("", response_model=list[ReminderOut])
def list_reminders(
    project_id: int | None = None,
    task_id: int | None = None,
    status_filter: str | None = Query(default=None, alias="status"),
    current: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    if status_filter is not None:
        _validate_status(status_filter)
    # Anchor-scoped badge queries keep the no-enumeration shape: unknown or
    # invisible anchors are 404, like the Task list gate.
    if task_id is not None:
        from app.tasks.models import Task, TaskAssignee, TaskWatcher

        task = session.get(Task, task_id)
        if task is None:
            raise HTTPException(status_code=404, detail="Not found")
        try:
            _require_write_on_project_read(task.project_id, current, session)
        except HTTPException:
            assert current.id is not None
            allowed = (
                current.role == "admin"
                or session.get(TaskAssignee, (task_id, current.id)) is not None
                or session.get(TaskWatcher, (task_id, current.id)) is not None
            )
            if not allowed:
                raise HTTPException(status_code=404, detail="Not found")
    if project_id is not None:
        _require_write_on_project_read(project_id, current, session)
    rows = _visible_reminders(session, current)
    if project_id is not None:
        rows = [r for r in rows if r.project_id == project_id]
    if task_id is not None:
        rows = [r for r in rows if r.task_id == task_id]
    if status_filter is not None:
        wanted = _validate_status(status_filter)
        rows = [r for r in rows if r.status == wanted]
    else:
        rows = [r for r in rows if r.status == "active"]
    return [_out(r, session) for r in rows]


def _require_write_on_project_read(project_id: int, current: User, session: Session) -> None:
    """Read-side anchor gate: membership OR anchor roles, else 404."""
    from app.projects.models import Project

    proj = session.get(Project, project_id)
    if proj is None:
        raise HTTPException(status_code=404, detail="Not found")
    if current.role == "admin":
        return
    try:
        require_project_access(project_id, current, session)
        return
    except HTTPException:
        pass
    assert current.id is not None
    if proj.owner_id == current.id:
        return
    raise HTTPException(status_code=404, detail="Not found")


@router.get("/{reminder_id}", response_model=ReminderOut)
def get_reminder(
    reminder_id: int,
    current: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    reminder = session.get(Reminder, reminder_id)
    if reminder is None:
        raise HTTPException(status_code=404, detail="Not found")
    _require_visible(session, reminder, current)
    return _out(reminder, session)


@router.patch("/{reminder_id}", response_model=ReminderOut)
def update_reminder(
    reminder_id: int,
    body: ReminderUpdate,
    current: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    reminder = session.get(Reminder, reminder_id)
    if reminder is None:
        raise HTTPException(status_code=404, detail="Not found")
    anchor_pid = _resolve_anchor_project_id(session, reminder.project_id, reminder.task_id)
    _require_write_on_project(anchor_pid, current, session)
    if body.title is not None:
        title = body.title.strip()
        if not title:
            raise HTTPException(status_code=422, detail="Title required")
        reminder.title = title[:256]
    if body.note is not None:
        reminder.note = body.note[:2000]
    if body.due_at is not None:
        due_at = body.due_at.strip()
        if not due_at:
            raise HTTPException(status_code=422, detail="due_at required")
        reminder.due_at = due_at[:32]
    if body.status is not None:
        reminder.status = _validate_status(body.status)
    # Optional re-anchor keeps the exactly-one invariant.
    fields = body.model_fields_set
    if "project_id" in fields or "task_id" in fields:
        new_project = body.project_id if "project_id" in fields else reminder.project_id
        new_task = body.task_id if "task_id" in fields else reminder.task_id
        _validate_anchor(new_project, new_task)
        new_pid = _resolve_anchor_project_id(session, new_project, new_task)
        _require_write_on_project(new_pid, current, session)
        reminder.project_id = new_project
        reminder.task_id = new_task
    reminder.updated_at = _now()
    session.add(reminder)
    session.commit()
    session.refresh(reminder)
    return _out(reminder, session)


def _resolve(session: Session, reminder_id: int, to: str, current: User) -> Reminder:
    reminder = session.get(Reminder, reminder_id)
    if reminder is None:
        raise HTTPException(status_code=404, detail="Not found")
    anchor_pid = _resolve_anchor_project_id(session, reminder.project_id, reminder.task_id)
    _require_write_on_project(anchor_pid, current, session)
    reminder.status = to
    reminder.updated_at = _now()
    session.add(reminder)
    session.commit()
    session.refresh(reminder)
    return reminder


@router.post("/{reminder_id}/done", response_model=ReminderOut)
def resolve_done(
    reminder_id: int,
    current: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    return _out(_resolve(session, reminder_id, "done", current), session)


@router.post("/{reminder_id}/dismiss", response_model=ReminderOut)
def resolve_dismiss(
    reminder_id: int,
    current: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    return _out(_resolve(session, reminder_id, "dismissed", current), session)


@router.delete("/{reminder_id}")
def delete_reminder(
    reminder_id: int,
    current: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    reminder = session.get(Reminder, reminder_id)
    if reminder is None:
        raise HTTPException(status_code=404, detail="Not found")
    anchor_pid = _resolve_anchor_project_id(session, reminder.project_id, reminder.task_id)
    _require_write_on_project(anchor_pid, current, session)
    session.delete(reminder)
    session.commit()
    return {"id": reminder_id, "deleted": True}
