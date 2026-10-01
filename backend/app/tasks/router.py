from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlmodel import Session, select

from app.auth.models import User
from app.deps import get_current_user, get_session
from app.projects.models import ProjectMember
from app.projects.router import require_project_access, is_member
from app.tasks.models import (
    Task,
    TaskAssignee,
    TaskWatcher,
    Tag,
    TaskTag,
    TaskBlockedBy,
    TaskHistory,
    TaskStatusPeriod,
)
from app.statuses.models import Status, StatusProfile

router = APIRouter(prefix="/api/v1/tasks", tags=["tasks"])


class TaskCreate(BaseModel):
    project_id: int
    parent_id: int | None = None
    title: str
    description_md: str = ""
    status_id: int
    priority: str = "normal"
    start_date: str
    due_date: str | None = None
    estimate_mins: int | None = None
    assignee_ids: list[int] = []
    watcher_ids: list[int] = []
    tag_names: list[str] = []
    blocked_by_ids: list[int] = []


class TaskUpdate(BaseModel):
    title: str | None = None
    description_md: str | None = None
    status_id: int | None = None
    priority: str | None = None
    start_date: str | None = None
    due_date: str | None = None
    estimate_mins: int | None = None
    time_spent_mins: int | None = None


class TaskStatusChange(BaseModel):
    status_id: int
    start_date: str | None = None
    due_date: str | None = None
    actual_end_date: str | None = None


class StatusPeriodOut(BaseModel):
    id: int
    task_id: int
    status_id: int
    start_date: str | None = None
    due_date: str | None = None
    actual_end_date: str | None = None
    actor_id: int | None = None
    created_at: str
    updated_at: str


class TaskHistoryOut(BaseModel):
    id: int
    task_id: int
    from_status_id: int | None = None
    to_status_id: int
    actor_id: int | None = None
    at: str


class TaskOut(BaseModel):
    id: int
    project_id: int
    parent_id: int | None = None
    depth: int
    title: str
    description_md: str
    status_id: int
    priority: str
    start_date: str
    due_date: str | None = None
    estimate_mins: int | None = None
    time_spent_mins: int
    created_by: int | None = None
    updated_at: str
    assignee_ids: list[int] = []
    watcher_ids: list[int] = []
    tag_names: list[str] = []
    blocked_by_ids: list[int] = []
    is_blocked: bool = False
    status_periods: list[StatusPeriodOut] = []


def _task_out(t: Task, session: Session) -> TaskOut:
    assert t.id is not None
    assignees = [a.user_id for a in session.exec(select(TaskAssignee).where(TaskAssignee.task_id == t.id)).all() if a.user_id is not None]
    watchers = [w.user_id for w in session.exec(select(TaskWatcher).where(TaskWatcher.task_id == t.id)).all() if w.user_id is not None]
    tag_ids = [tt.tag_id for tt in session.exec(select(TaskTag).where(TaskTag.task_id == t.id)).all()]
    tag_names = []
    if tag_ids:
        tags = session.exec(select(Tag).where(Tag.id.in_(tag_ids))).all()  # type: ignore[attr-defined, union-attr]
        tag_names = [tg.name for tg in tags]
    blocked_by = [b.blocked_by_task_id for b in session.exec(select(TaskBlockedBy).where(TaskBlockedBy.task_id == t.id)).all() if b.blocked_by_task_id is not None]
    
    # check if any blocked_by task is not done
    is_blocked = False
    if blocked_by:
        bb_tasks = session.exec(select(Task).where(Task.id.in_(blocked_by))).all()  # type: ignore[attr-defined, union-attr]
        for bb in bb_tasks:
            st = session.get(Status, bb.status_id)
            if st and not st.is_done:
                is_blocked = True
                break

    periods = session.exec(select(TaskStatusPeriod).where(TaskStatusPeriod.task_id == t.id)).all()
    periods_out = [
        StatusPeriodOut(
            id=p.id,  # type: ignore[arg-type]
            task_id=p.task_id,
            status_id=p.status_id,
            start_date=p.start_date,
            due_date=p.due_date,
            actual_end_date=p.actual_end_date,
            actor_id=p.actor_id,
            created_at=p.created_at,
            updated_at=p.updated_at,
        )
        for p in periods
    ]

    return TaskOut(
        id=t.id,
        project_id=t.project_id,
        parent_id=t.parent_id,
        depth=t.depth,
        title=t.title,
        description_md=t.description_md,
        status_id=t.status_id,
        priority=t.priority,
        start_date=t.start_date,
        due_date=t.due_date,
        estimate_mins=t.estimate_mins,
        time_spent_mins=t.time_spent_mins,
        created_by=t.created_by,
        updated_at=t.updated_at,
        assignee_ids=assignees,
        watcher_ids=watchers,
        tag_names=tag_names,
        blocked_by_ids=blocked_by,
        is_blocked=is_blocked,
        status_periods=periods_out,
    )


@router.get("", response_model=list[TaskOut])
def list_tasks(
    project_id: int | None = None,
    status_id: int | None = None,
    assignee_id: int | None = None,
    watcher_id: int | None = None,
    tag: str | None = None,
    blocked: bool | None = None,
    overdue: bool | None = None,
    search: str | None = None,
    depth: int | None = None,
    current: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    query = select(Task)
    if project_id is not None:
        require_project_access(project_id, current, session)
        query = query.where(Task.project_id == project_id)
    else:
        # if no project_id, filter by projects user has access to
        if current.role != "admin":
            mrows = session.exec(select(ProjectMember).where(ProjectMember.user_id == current.id)).all()
            pids = [m.project_id for m in mrows if m.project_id is not None]
            if not pids:
                return []
            query = query.where(Task.project_id.in_(pids))  # type: ignore[attr-defined, union-attr]

    if status_id is not None:
        query = query.where(Task.status_id == status_id)
    if depth is not None:
        query = query.where(Task.depth == depth)
    if search:
        query = query.where(Task.title.contains(search) | Task.description_md.contains(search))  # type: ignore[attr-defined]

    tasks = session.exec(query.order_by(Task.id)).all()  # type: ignore[arg-type]
    results = []
    for t in tasks:
        tout = _task_out(t, session)
        if assignee_id is not None and assignee_id not in tout.assignee_ids:
            continue
        if watcher_id is not None and watcher_id not in tout.watcher_ids:
            continue
        if tag is not None and tag not in tout.tag_names:
            continue
        if blocked is not None and tout.is_blocked != blocked:
            continue
        results.append(tout)
    return results


@router.post("", response_model=TaskOut, status_code=status.HTTP_201_CREATED)
def create_task(
    body: TaskCreate,
    current: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    project = require_project_access(body.project_id, current, session)
    if current.role == "guest":
        raise HTTPException(status_code=403, detail="Guest cannot create tasks")

    # Validate status belongs to project profile
    status_obj = session.get(Status, body.status_id)
    if not status_obj:
        raise HTTPException(status_code=400, detail="Invalid status_id")

    depth = 0
    if body.parent_id is not None:
        parent = session.get(Task, body.parent_id)
        if not parent or parent.project_id != body.project_id:
            raise HTTPException(status_code=400, detail="Invalid parent task")
        if parent.depth >= 2:
            raise HTTPException(status_code=400, detail="Hierarchy depth capped at 2 (Task > 1.1 > 1.1.1)")
        depth = parent.depth + 1

    assert current.id is not None
    task = Task(
        project_id=body.project_id,
        parent_id=body.parent_id,
        depth=depth,
        title=body.title,
        description_md=body.description_md,
        status_id=body.status_id,
        priority=body.priority,
        start_date=body.start_date,
        due_date=body.due_date,
        estimate_mins=body.estimate_mins,
        created_by=current.id,
    )
    session.add(task)
    session.commit()
    session.refresh(task)
    assert task.id is not None

    # Assignees
    for uid in body.assignee_ids:
        session.add(TaskAssignee(task_id=task.id, user_id=uid))
    # Watchers
    for uid in body.watcher_ids:
        session.add(TaskWatcher(task_id=task.id, user_id=uid))
    # Tags
    for tname in body.tag_names:
        tag_obj = session.exec(select(Tag).where(Tag.name == tname)).first()
        if not tag_obj:
            tag_obj = Tag(name=tname)
            session.add(tag_obj)
            session.commit()
            session.refresh(tag_obj)
        assert tag_obj.id is not None
        session.add(TaskTag(task_id=task.id, tag_id=tag_obj.id))
    # Blocked by
    for bvid in body.blocked_by_ids:
        session.add(TaskBlockedBy(task_id=task.id, blocked_by_task_id=bvid))

    # Initial Status Period & History
    period = TaskStatusPeriod(
        task_id=task.id,
        status_id=task.status_id,
        start_date=task.start_date,
        due_date=task.due_date,
        actor_id=current.id,
    )
    session.add(period)
    session.add(TaskHistory(task_id=task.id, from_status_id=None, to_status_id=task.status_id, actor_id=current.id))
    session.commit()
    session.refresh(task)
    return _task_out(task, session)


class BlockedMapItem(BaseModel):
    task_id: int
    title: str
    blocked_by: list[int] = []


@router.get("/blocked-map", response_model=list[BlockedMapItem])
def get_blocked_map(
    project_id: int,
    current: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    require_project_access(project_id, current, session)
    tasks = session.exec(select(Task).where(Task.project_id == project_id)).all()
    result = []
    for t in tasks:
        assert t.id is not None
        bblocks = [b.blocked_by_task_id for b in session.exec(select(TaskBlockedBy).where(TaskBlockedBy.task_id == t.id)).all() if b.blocked_by_task_id is not None]
        result.append(BlockedMapItem(task_id=t.id, title=t.title, blocked_by=bblocks))
    return result


@router.get("/{task_id}", response_model=TaskOut)
def get_task(
    task_id: int,
    current: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    task = session.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    require_project_access(task.project_id, current, session)
    return _task_out(task, session)


@router.put("/{task_id}", response_model=TaskOut)
def update_task(
    task_id: int,
    body: TaskUpdate,
    current: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    task = session.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    require_project_access(task.project_id, current, session)
    if current.role == "guest":
        raise HTTPException(status_code=403, detail="Guest cannot update tasks")

    old_status_id = task.status_id
    if body.title is not None:
        task.title = body.title
    if body.description_md is not None:
        task.description_md = body.description_md
    if body.priority is not None:
        task.priority = body.priority
    if body.start_date is not None:
        task.start_date = body.start_date
    if body.due_date is not None:
        task.due_date = body.due_date
    if body.estimate_mins is not None:
        task.estimate_mins = body.estimate_mins
    if body.time_spent_mins is not None:
        task.time_spent_mins = body.time_spent_mins

    if body.status_id is not None and body.status_id != task.status_id:
        status_obj = session.get(Status, body.status_id)
        if not status_obj:
            raise HTTPException(status_code=400, detail="Invalid status_id")
        task.status_id = body.status_id
        assert current.id is not None
        assert task.id is not None
        session.add(TaskHistory(task_id=task.id, from_status_id=old_status_id, to_status_id=task.status_id, actor_id=current.id))
        
        # Upsert period
        period = session.exec(select(TaskStatusPeriod).where(TaskStatusPeriod.task_id == task.id, TaskStatusPeriod.status_id == task.status_id)).first()
        if not period:
            period = TaskStatusPeriod(task_id=task.id, status_id=task.status_id, start_date=task.start_date, actor_id=current.id)
            session.add(period)

    task.updated_at = datetime.now(timezone.utc).isoformat()
    session.add(task)
    session.commit()
    session.refresh(task)
    return _task_out(task, session)


@router.post("/{task_id}/status", response_model=TaskOut)
def change_task_status(
    task_id: int,
    body: TaskStatusChange,
    current: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    task = session.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    require_project_access(task.project_id, current, session)
    if current.role == "guest":
        raise HTTPException(status_code=403, detail="Guest cannot change task status")

    status_obj = session.get(Status, body.status_id)
    if not status_obj:
        raise HTTPException(status_code=400, detail="Invalid status_id")

    old_status_id = task.status_id
    task.status_id = body.status_id
    task.updated_at = datetime.now(timezone.utc).isoformat()
    session.add(task)

    assert current.id is not None
    assert task.id is not None
    # Record history
    session.add(TaskHistory(task_id=task.id, from_status_id=old_status_id, to_status_id=body.status_id, actor_id=current.id))

    # Upsert Status Period for new status
    period = session.exec(select(TaskStatusPeriod).where(TaskStatusPeriod.task_id == task.id, TaskStatusPeriod.status_id == body.status_id)).first()
    if period:
        if body.start_date is not None:
            period.start_date = body.start_date
        if body.due_date is not None:
            period.due_date = body.due_date
        if body.actual_end_date is not None:
            period.actual_end_date = body.actual_end_date
        period.actor_id = current.id
        period.updated_at = datetime.now(timezone.utc).isoformat()
        session.add(period)
    else:
        period = TaskStatusPeriod(
            task_id=task.id,
            status_id=body.status_id,
            start_date=body.start_date or task.start_date,
            due_date=body.due_date,
            actual_end_date=body.actual_end_date,
            actor_id=current.id,
        )
        session.add(period)

    session.commit()
    session.refresh(task)
    return _task_out(task, session)


@router.get("/{task_id}/history", response_model=list[TaskHistoryOut])
def get_task_history(
    task_id: int,
    current: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    task = session.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    require_project_access(task.project_id, current, session)
    history = session.exec(select(TaskHistory).where(TaskHistory.task_id == task_id).order_by(TaskHistory.id)).all()  # type: ignore[arg-type]
    return [
        TaskHistoryOut(
            id=h.id,  # type: ignore[arg-type]
            task_id=h.task_id,
            from_status_id=h.from_status_id,
            to_status_id=h.to_status_id,
            actor_id=h.actor_id,
            at=h.at,
        )
        for h in history
    ]
