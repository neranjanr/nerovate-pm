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
    repeat: str = "none"
    repeat_end: str = "never"
    repeat_after_n: int | None = None
    repeat_until: str | None = None


class ReminderUpdate(BaseModel):
    title: str | None = None
    note: str | None = None
    due_at: str | None = None
    status: str | None = None
    project_id: int | None = None
    task_id: int | None = None
    repeat: str | None = None
    repeat_end: str | None = None
    repeat_after_n: int | None = None
    repeat_until: str | None = None


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
    # 03 detach: standalone keeps ex-anchor context.
    ex_anchor_title: str = ""
    ex_anchor_project_id: int | None = None
    is_detached: bool = False
    detached_at: str | None = None
    created_by: int | None = None
    created_at: str
    updated_at: str
    # 02 recurrence + snooze; is_overdue derives from due date + snooze.
    repeat: str = "none"
    repeat_end: str = "never"
    repeat_after_n: int | None = None
    repeat_until: str | None = None
    occurrence_index: int = 0
    snoozed_until: str | None = None
    is_overdue: bool = False


class FireOut(BaseModel):
    reminder: ReminderOut
    notify_user_ids: list[int] = []
    follow_up: dict = {}


class FollowUpCreate(BaseModel):
    name: str
    code: str | None = None
    category_id: int | None = None
    description: str = ""


class FollowUpOut(BaseModel):
    reminder: ReminderOut
    project: dict
    link: dict | None = None


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _validate_status(value: str) -> str:
    v = (value or "").strip().lower()
    if v not in REMINDER_STATUSES:
        raise HTTPException(status_code=422, detail="Invalid status (active|done|dismissed)")
    return v


def _validate_recurrence(
    repeat: str | None,
    repeat_end: str | None,
    repeat_after_n: int | None,
    repeat_until: str | None,
) -> tuple[str, str]:
    """02: repeat none|daily|weekly|monthly|yearly, end never|after|until."""
    from app.reminders.service import REPEAT_ENDS, REPEAT_STEPS

    rep = (repeat or "none").strip().lower()
    end = (repeat_end or "never").strip().lower()
    if rep not in REPEAT_STEPS:
        raise HTTPException(status_code=422, detail="Invalid repeat (none|daily|weekly|monthly|yearly)")
    if end not in REPEAT_ENDS:
        raise HTTPException(status_code=422, detail="Invalid repeat_end (never|after|until)")
    if rep == "none":
        return "none", "never"
    if end == "after" and (repeat_after_n is None or repeat_after_n < 1):
        raise HTTPException(status_code=422, detail="repeat_after_n >= 1 required for end 'after'")
    if end == "until" and not (repeat_until or "").strip():
        raise HTTPException(status_code=422, detail="repeat_until required for end 'until'")
    return rep, end


def _is_overdue(reminder: Reminder) -> bool:
    """02: active + due date reached + not snoozed past now (server-local)."""
    if (reminder.status or "") != "active":
        return False
    from app.reminders.service import split_due

    try:
        due_date = split_due(reminder.due_at)[0]
        today = datetime.now().date().isoformat()
        if due_date > today:
            return False
    except Exception:
        return False
    snoozed = (getattr(reminder, "snoozed_until", None) or "").strip()
    if snoozed and snoozed > _now():
        return False
    return True


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
    """Read gate: project union membership, else anchor roles.

    03 detach: standalone (both FKs null) stays visible to the creator,
    admins, and members of the ex-anchor Project while it still exists,
    so detached nudges keep surfacing in My Reminders.
    """
    assert reminder.id is not None
    assert user.id is not None
    if user.role == "admin":
        return True
    if reminder.project_id is None and reminder.task_id is None:
        if reminder.created_by == user.id:
            return True
        ex_pid = getattr(reminder, "ex_anchor_project_id", None)
        if ex_pid is not None:
            try:
                require_project_access(ex_pid, user, session)
                return True
            except HTTPException:
                pass
            try:
                from app.projects.models import Project

                proj = session.get(Project, ex_pid)
                if proj is not None and proj.owner_id == user.id:
                    return True
            except Exception:
                pass
        return False
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
    from app.reminders.service import is_detached as _is_detached

    detached = _is_detached(reminder)
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
    if detached:
        anchor_pid = anchor_pid or getattr(reminder, "ex_anchor_project_id", None)
        anchor_title = anchor_title or (reminder.ex_anchor_title or None)
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
        ex_anchor_title=reminder.ex_anchor_title or "",
        ex_anchor_project_id=getattr(reminder, "ex_anchor_project_id", None),
        is_detached=detached,
        detached_at=getattr(reminder, "detached_at", None),
        created_by=reminder.created_by,
        created_at=reminder.created_at,
        updated_at=reminder.updated_at,
        repeat=getattr(reminder, "repeat", None) or "none",
        repeat_end=getattr(reminder, "repeat_end", None) or "never",
        repeat_after_n=getattr(reminder, "repeat_after_n", None),
        repeat_until=getattr(reminder, "repeat_until", None),
        occurrence_index=getattr(reminder, "occurrence_index", 0) or 0,
        snoozed_until=getattr(reminder, "snoozed_until", None),
        is_overdue=_is_overdue(reminder),
    )


def _require_write(session: Session, reminder: Reminder, user: User) -> int | None:
    """Task edit gate, extended to detached: creator/admin or ex-anchor write."""
    assert user.id is not None
    if reminder.task_id is None and reminder.project_id is None:
        # Detached standalone: creator + admin always; ex-anchor project
        # writers (non-guest) when that project still exists.
        if user.role == "admin" or reminder.created_by == user.id:
            return getattr(reminder, "ex_anchor_project_id", None)
        ex_pid = getattr(reminder, "ex_anchor_project_id", None)
        if ex_pid is not None:
            try:
                _require_write_on_project(ex_pid, user, session)
                return ex_pid
            except HTTPException:
                pass
        raise HTTPException(status_code=404, detail="Not found")
    pid = _resolve_anchor_project_id(session, reminder.project_id, reminder.task_id)
    _require_write_on_project(pid, user, session)
    return pid


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
    rep, end = _validate_recurrence(body.repeat, body.repeat_end, body.repeat_after_n, body.repeat_until)
    assert current.id is not None
    from app.reminders.service import normalize_due_at

    reminder = Reminder(
        title=title[:256],
        note=(body.note or "")[:2000],
        due_at=normalize_due_at(due_at)[:32],
        status="active",
        project_id=body.project_id,
        task_id=body.task_id,
        created_by=current.id,
        repeat=rep,
        repeat_end=end,
        repeat_after_n=body.repeat_after_n if end == "after" else None,
        repeat_until=(body.repeat_until or "").strip()[:32] if end == "until" else None,
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
    _require_write(session, reminder, current)
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
        from app.reminders.service import normalize_due_at

        reminder.due_at = normalize_due_at(due_at)[:32]
    if body.status is not None:
        reminder.status = _validate_status(body.status)
    # 02 recurrence edits keep the validated combination coherent.
    fields = body.model_fields_set
    if (
        "repeat" in fields
        or "repeat_end" in fields
        or "repeat_after_n" in fields
        or "repeat_until" in fields
    ):
        rep, end = _validate_recurrence(
            body.repeat if "repeat" in fields else reminder.repeat,
            body.repeat_end if "repeat_end" in fields else reminder.repeat_end,
            body.repeat_after_n if "repeat_after_n" in fields else reminder.repeat_after_n,
            body.repeat_until if "repeat_until" in fields else reminder.repeat_until,
        )
        reminder.repeat = rep
        reminder.repeat_end = end
        reminder.repeat_after_n = (
            (body.repeat_after_n if "repeat_after_n" in fields else reminder.repeat_after_n)
            if end == "after"
            else None
        )
        until_raw = body.repeat_until if "repeat_until" in fields else reminder.repeat_until
        reminder.repeat_until = (until_raw or "").strip()[:32] if end == "until" else None
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
    _require_write(session, reminder, current)
    was_active = (reminder.status or "") == "active"
    reminder.status = to
    reminder.snoozed_until = None
    reminder.updated_at = _now()
    session.add(reminder)
    # 02: Done/Dismiss on a recurring active Reminder schedules the next
    # occurrence from the due date (no drift); ended cadences just resolve.
    if was_active:
        from app.reminders.service import chain_next

        chain_next(session, reminder)
    session.commit()
    session.refresh(reminder)
    return reminder


class SnoozeIn(BaseModel):
    duration: str = "1d"


@router.post("/{reminder_id}/snooze", response_model=ReminderOut)
def snooze_reminder(
    reminder_id: int,
    body: SnoozeIn,
    current: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """02: snooze an active Reminder for 1d or 1w (suppresses overdue)."""
    from datetime import timedelta

    reminder = session.get(Reminder, reminder_id)
    if reminder is None:
        raise HTTPException(status_code=404, detail="Not found")
    _require_write(session, reminder, current)
    if (reminder.status or "") != "active":
        raise HTTPException(status_code=422, detail="Only active reminders can be snoozed")
    dur = (body.duration or "").strip().lower()
    if dur not in ("1d", "1w"):
        raise HTTPException(status_code=422, detail="Invalid duration (1d|1w)")
    delta = timedelta(days=1 if dur == "1d" else 7)
    reminder.snoozed_until = (datetime.now(timezone.utc) + delta).isoformat()
    reminder.updated_at = _now()
    session.add(reminder)
    session.commit()
    session.refresh(reminder)
    return _out(reminder, session)


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
    _require_write(session, reminder, current)
    session.delete(reminder)
    session.commit()
    return {"id": reminder_id, "deleted": True}


@router.post("/{reminder_id}/fire", response_model=FireOut)
def fire_reminder(
    reminder_id: int,
    current: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """Firing notifies Assignee + Watchers + Project Owners (03).

    Read-gated (visible users may fire); never auto-creates follow-up work.
    The follow_up payload is the one-click offer: source project + kind.
    """
    from app.events import publish
    from app.reminders.service import notify_user_ids, source_project_id

    reminder = session.get(Reminder, reminder_id)
    if reminder is None:
        raise HTTPException(status_code=404, detail="Not found")
    _require_visible(session, reminder, current)
    notify = notify_user_ids(session, reminder)
    src = source_project_id(session, reminder)
    suggested = f"{reminder.title} (follow-up)"
    publish(
        "reminder.fired",
        {"reminder_id": reminder_id, "notify_user_ids": notify, "source_project_id": src},
    )
    return FireOut(
        reminder=_out(reminder, session),
        notify_user_ids=notify,
        follow_up={
            "source_project_id": src,
            "kind": "continues-as",
            "suggested_name": suggested,
        },
    )


@router.post("/{reminder_id}/follow-up-project", response_model=FollowUpOut, status_code=201)
def create_follow_up_project(
    reminder_id: int,
    body: FollowUpCreate,
    current: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """One-click follow-up: new Project pre-linked continues-as (03).

    The Reminder stays on the original anchor; only an explicit call here
    creates work. Forward link is plain (ADR-0006): no rollup, no blocking.
    """
    import re

    from app.categories.models import Category, CategoryMember
    from app.events import publish
    from app.projects.models import Project, ProjectLink, ProjectMember
    from app.reminders.service import source_project_id

    CODE_RE = re.compile(r"^[A-Z0-9-]{2,12}$")

    reminder = session.get(Reminder, reminder_id)
    if reminder is None:
        raise HTTPException(status_code=404, detail="Not found")
    _require_visible(session, reminder, current)
    _require_write(session, reminder, current)
    assert current.id is not None

    src_pid = source_project_id(session, reminder)
    src_proj = session.get(Project, src_pid) if src_pid is not None else None

    name = (body.name or "").strip()
    if not name:
        raise HTTPException(status_code=422, detail="Name required")

    category_id = body.category_id
    if category_id is None:
        if src_proj is not None and getattr(src_proj, "category_id", None) is not None:
            category_id = src_proj.category_id
        else:
            raise HTTPException(status_code=422, detail="category_id required")
    assert category_id is not None
    category = session.get(Category, category_id)
    if category is None:
        raise HTTPException(status_code=404, detail="Not found")
    if current.role not in ("admin", "manager"):
        if session.get(CategoryMember, (category_id, current.id)) is None:
            raise HTTPException(status_code=404, detail="Not found")

    code = (body.code or "").strip().upper()
    if not code:
        base = "".join(c for c in name.upper() if c.isalnum())[:6] or "PRJ"
        code = f"{base}-{abs(hash(name + str(reminder_id))) % 900 + 100}"
        if not CODE_RE.match(code):
            code = f"PRJ-{abs(hash(name)) % 9000 + 1000}"
    if not CODE_RE.match(code):
        raise HTTPException(status_code=400, detail="Invalid code (A-Z0-9-, 2-12 chars)")
    if session.exec(
        select(Project).where(Project.category_id == category_id, Project.code == code)
    ).first():
        raise HTTPException(status_code=422, detail="Code exists in this Category")
    if session.exec(
        select(Project).where(Project.category_id == category_id, Project.name == name)
    ).first():
        raise HTTPException(status_code=422, detail="Name exists in this Category")

    new_proj = Project(
        category_id=category_id,
        name=name,
        code=code,
        description=(body.description or "")[:2000],
        color=getattr(src_proj, "color", None) or "#6b7280",
        owner_id=current.id,
        project_status="Active",
    )
    session.add(new_proj)
    try:
        session.commit()
    except Exception as exc:
        session.rollback()
        msg = str(exc).lower()
        if "unique" in msg:
            raise HTTPException(status_code=422, detail="Code or name exists in this Category")
        raise
    session.refresh(new_proj)
    assert new_proj.id is not None
    if session.get(ProjectMember, (new_proj.id, current.id)) is None:
        session.add(ProjectMember(project_id=new_proj.id, user_id=current.id, role=current.role))
    if session.get(CategoryMember, (category_id, current.id)) is None:
        try:
            session.add(CategoryMember(category_id=category_id, user_id=current.id, role=current.role))
        except Exception:
            pass
    session.commit()

    link_out: dict | None = None
    if src_proj is not None and src_proj.id is not None:
        existing = session.exec(
            select(ProjectLink).where(
                ProjectLink.from_project_id == src_proj.id,
                ProjectLink.to_project_id == new_proj.id,
                ProjectLink.kind == "continues-as",
            )
        ).first()
        if existing is None:
            link = ProjectLink(
                from_project_id=src_proj.id,
                to_project_id=new_proj.id,
                kind="continues-as",
                note=f"follow-up of reminder {reminder_id}",
                created_by=current.id,
            )
            session.add(link)
            session.commit()
            session.refresh(link)
        else:
            link = existing
        assert link.id is not None
        link_out = {
            "id": link.id,
            "from_project_id": link.from_project_id,
            "to_project_id": link.to_project_id,
            "kind": link.kind,
            "note": link.note,
        }
    publish(
        "reminder.follow_up_created",
        {
            "reminder_id": reminder_id,
            "from_project_id": src_pid,
            "to_project_id": new_proj.id,
        },
    )
    session.refresh(reminder)
    return FollowUpOut(
        reminder=_out(reminder, session),
        project={
            "id": new_proj.id,
            "name": new_proj.name,
            "code": new_proj.code,
            "category_id": new_proj.category_id,
            "description": new_proj.description,
        },
        link=link_out,
    )
