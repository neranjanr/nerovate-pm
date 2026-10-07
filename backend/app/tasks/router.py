import csv
import io
import os
from datetime import date
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel
from sqlmodel import Session, select

from app.access import can_access_view
from app.auth.models import User
from app.deps import get_current_user, get_session
from app.events import publish
from app.projects.models import ProjectMember, Project
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
    TaskComment,
    TaskCommentMention,
    TaskAttachment,
)
from app.statuses.models import Status, StatusProfile, CustomFieldDef, CustomFieldValue

router = APIRouter(prefix="/api/v1/tasks", tags=["tasks"])


class TaskCreate(BaseModel):
    project_id: int
    parent_id: int | None = None
    title: str
    description_md: str = ""
    status_id: int | None = None
    priority: str = "normal"
    start_date: str | None = None
    due_date: str | None = None
    estimate_mins: int | None = None
    assignee_ids: list[int] = []
    watcher_ids: list[int] = []
    tag_names: list[str] = []
    blocked_by_ids: list[int] = []


class TaskDefaultsOut(BaseModel):
    project_id: int
    status_id: int | None = None
    status_name: str | None = None
    stage_id: int | None = None
    stage_name: str | None = None
    start_date: str


class TaskUpdate(BaseModel):
    title: str | None = None
    description_md: str | None = None
    status_id: int | None = None
    priority: str | None = None
    start_date: str | None = None
    due_date: str | None = None
    estimate_mins: int | None = None
    time_spent_mins: int | None = None
    assignee_ids: list[int] | None = None
    watcher_ids: list[int] | None = None
    tag_names: list[str] | None = None
    blocked_by_ids: list[int] | None = None


def _default_status_for_project(session: Session, project_id: int) -> Status | None:
    """U4 default: first leaf Status of first Stage (ordered).

    Resolves Profile via parent Category (live reference, SPEC-v0.3 4.3);
    falls back to legacy projects.status_profile_id for pre-U2 data.
    """
    from app.categories.models import Category
    from app.projects.models import Project
    from app.statuses.models import StatusStage

    project = session.get(Project, project_id)
    if project is None:
        return None
    profile_id: int | None = None
    cat_id = getattr(project, "category_id", None)
    if cat_id is not None:
        cat = session.get(Category, cat_id)
        if cat is not None and cat.status_profile_id is not None:
            profile_id = cat.status_profile_id
    if profile_id is None:
        profile_id = getattr(project, "status_profile_id", None)
    if profile_id is None:
        return None
    stages = list(
        session.exec(
            select(StatusStage)
            .where(StatusStage.profile_id == profile_id)
            .order_by(StatusStage.order)  # type: ignore[arg-type]
        ).all()
    )
    for first_stage in stages:
        assert first_stage.id is not None
        first_leaf_candidates = list(
            session.exec(
                select(Status)
                .where(Status.stage_id == first_stage.id)
                .order_by(Status.order)  # type: ignore[arg-type]
            ).all()
        )
        if first_leaf_candidates:
            return first_leaf_candidates[0]
    rows = list(
        session.exec(
            select(Status)
            .where(Status.profile_id == profile_id)
            .order_by(Status.order)  # type: ignore[arg-type]
        ).all()
    )
    return rows[0] if rows else None


def _validate_blocked_by(
    task_id: int | None,
    blocked_by_ids: list[int],
    session: Session,
    project_id: int | None = None,
) -> None:
    """Reject self-refs, duplicates, and circular chains of any length (SPEC 4.4).

    U4: blocked-by stays same-Project only (cross-Project deferred).
    """
    if task_id is not None and task_id in blocked_by_ids:
        raise HTTPException(status_code=400, detail="Task cannot block itself")
    if len(set(blocked_by_ids)) != len(blocked_by_ids):
        raise HTTPException(status_code=400, detail="Duplicate blocked_by ids")
    if project_id is not None:
        for bvid in blocked_by_ids:
            other = session.get(Task, bvid)
            if other is None or other.project_id != project_id:
                raise HTTPException(status_code=400, detail="blocked_by must be same-Project")
    if task_id is None:
        return
    # DFS from each proposed dependency: if we can reach task_id, it closes a cycle.
    for start in blocked_by_ids:
        seen: set[int] = set()
        stack = [start]
        while stack:
            cur = stack.pop()
            if cur == task_id:
                raise HTTPException(status_code=400, detail="Circular blocked-by refs")
            if cur in seen:
                continue
            seen.add(cur)
            for link in session.exec(
                select(TaskBlockedBy).where(TaskBlockedBy.task_id == cur)
            ).all():
                if link.blocked_by_task_id is not None and link.blocked_by_task_id not in seen:
                    stack.append(link.blocked_by_task_id)


def _mention_ids_for_comment(comment_id: int, session: Session) -> list[int]:
    rows = session.exec(
        select(TaskCommentMention).where(TaskCommentMention.comment_id == comment_id)
    ).all()
    return [r.user_id for r in rows]


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
    position: int = 0
    wbs: str = ""
    assignee_ids: list[int] = []
    watcher_ids: list[int] = []
    tag_names: list[str] = []
    blocked_by_ids: list[int] = []
    is_blocked: bool = False
    status_periods: list[StatusPeriodOut] = []


def _task_out(t: Task, session: Session, wbs_map: dict[int, str] | None = None) -> TaskOut:
    assert t.id is not None
    from app.tasks import service as _svc

    if wbs_map is None:
        try:
            wbs = _svc.wbs_for_task(session, t)
        except Exception:
            wbs = ""
    else:
        wbs = wbs_map.get(t.id, "")
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
        position=t.position if t.position is not None else 0,
        wbs=wbs,
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
    category_id: int | None = None,
    stage_id: int | None = None,
    status_id: int | None = None,
    status: int | None = None,
    assignee_id: int | None = None,
    assignee: int | None = None,
    watcher_id: int | None = None,
    watcher: int | None = None,
    tag: str | None = None,
    blocked: bool | None = None,
    overdue: bool | None = None,
    search: str | None = None,
    depth: int | None = None,
    current: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    return _filtered_task_outs(
        session,
        project_id=project_id,
        category_id=category_id,
        stage_id=stage_id,
        status_id=status_id if status_id is not None else status,
        assignee_id=assignee_id if assignee_id is not None else assignee,
        watcher_id=watcher_id if watcher_id is not None else watcher,
        tag=tag,
        blocked=blocked,
        overdue=overdue,
        search=search,
        depth=depth,
        current=current,
    )


def _stage_status_ids(session: Session, stage_id: int) -> list[int]:
    """Resolve leaf Status ids for a Stage; 404 on unknown Stage (U5)."""
    from app.statuses.models import StatusStage

    stage = session.get(StatusStage, stage_id)
    if stage is None:
        raise HTTPException(status_code=404, detail="Stage not found")
    rows = session.exec(select(Status).where(Status.stage_id == stage_id)).all()
    return [s.id for s in rows if s.id is not None]


def _filtered_task_outs(
    session: Session,
    *,
    project_id: int | None,
    category_id: int | None = None,
    stage_id: int | None = None,
    status_id: int | None = None,
    assignee_id: int | None = None,
    watcher_id: int | None = None,
    tag: str | None = None,
    blocked: bool | None = None,
    overdue: bool | None = None,
    search: str | None = None,
    depth: int | None = None,
    current: User,
) -> list[TaskOut]:
    """Single definition of List/Calendar/Table filters (SPEC-v0.2 4.5 + T8).

    SPEC-v0.3 4.5 (U5): gains category_id and stage_id filters.
    SQL-level: project/category (membership-gated), stage, status, depth, search.
    Python-level: assignee/watcher/tag/blocked/overdue (derived flags).
    """
    from app.tasks import service as tasks_service

    stage_ids: list[int] | None = None
    if stage_id is not None:
        stage_ids = _stage_status_ids(session, stage_id)

    query = select(Task)
    if project_id is not None:
        project = require_project_access(project_id, current, session)
        if category_id is not None:
            if getattr(project, "category_id", None) != category_id:
                return []
        query = query.where(Task.project_id == project_id)
    elif category_id is not None:
        from app.categories.router import require_category_access as _require_cat

        _require_cat(category_id, current, session)
        from app.projects.models import Project as _Project

        cat_pids = [
            p.id
            for p in session.exec(
                select(_Project).where(_Project.category_id == category_id)
            ).all()
            if p.id is not None
        ]
        if not cat_pids:
            return []
        if current.role != "admin":
            assert current.id is not None
            from app.categories.access import visible_project_ids as _visible

            visible = set(_visible(session, current.id))
            cat_pids = [pid for pid in cat_pids if pid in visible]
            if not cat_pids:
                return []
        query = query.where(Task.project_id.in_(cat_pids))  # type: ignore[attr-defined, union-attr]
    else:
        # if no project_id, filter by projects user has access to (hybrid union, U1)
        if current.role != "admin":
            assert current.id is not None
            from app.categories.access import visible_project_ids

            pids = visible_project_ids(session, current.id)
            if not pids:
                return []
            query = query.where(Task.project_id.in_(pids))  # type: ignore[attr-defined, union-attr]

    if stage_ids is not None:
        if not stage_ids:
            return []
        query = query.where(Task.status_id.in_(stage_ids))  # type: ignore[attr-defined, union-attr]
    if status_id is not None:
        query = query.where(Task.status_id == status_id)
    if depth is not None:
        query = query.where(Task.depth == depth)
    if search:
        query = query.where(Task.title.contains(search) | Task.description_md.contains(search))  # type: ignore[attr-defined]

    tasks = session.exec(query).all()
    # V1: sibling order is (position, id); NULL positions sort last.
    tasks = sorted(
        tasks,
        key=lambda t: (
            t.project_id,
            t.parent_id if t.parent_id is not None else -1,
            (t.position is None, t.position if t.position is not None else 0, t.id or 0),
        ),
    )
    today = date.today().isoformat()
    # Precompute WBS per project for the returned rows.
    wbs_by_project: dict[int, dict[int, str]] = {}
    for t in tasks:
        if t.project_id not in wbs_by_project:
            try:
                wbs_by_project[t.project_id] = tasks_service.wbs_map_for_project(session, t.project_id)
            except Exception:
                wbs_by_project[t.project_id] = {}
    results = []
    for t in tasks:
        assert t.id is not None
        tout = _task_out(t, session, wbs_map=wbs_by_project.get(t.project_id, {}))
        if assignee_id is not None and assignee_id not in tout.assignee_ids:
            continue
        if watcher_id is not None and watcher_id not in tout.watcher_ids:
            continue
        if tag is not None and tag not in tout.tag_names:
            continue
        if blocked is not None and tout.is_blocked != blocked:
            continue
        if overdue is not None:
            assert t.id is not None
            is_over = tasks_service.task_is_overdue(session, t, today)
            if is_over != overdue:
                continue
        results.append(tout)
    return results


class TaskReorder(BaseModel):
    item_id: int
    to_position: int
    parent_id: int | None = None


@router.post("/reorder", response_model=list[TaskOut])
def reorder_tasks(
    body: TaskReorder,
    current: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    item = session.get(Task, body.item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Task not found")
    require_project_access(item.project_id, current, session)
    if current.role == "guest":
        raise HTTPException(status_code=403, detail="Guest cannot reorder tasks")

    if body.parent_id is not None and body.parent_id != item.parent_id:
        raise HTTPException(status_code=400, detail="Cross-parent reorder not allowed")

    parent_id = item.parent_id
    project_id = item.project_id

    from app.tasks import service as _svc

    siblings = _svc.ordered_siblings(session, project_id, parent_id)
    siblings = [s for s in siblings if s.id != item.id]

    to_pos = max(1, min(body.to_position, len(siblings) + 1))
    siblings.insert(to_pos - 1, item)

    assert item.id is not None
    old_wbs_map = _svc.wbs_map_for_project(session, project_id)
    old_wbs = old_wbs_map.get(item.id, "")

    for idx, sib in enumerate(siblings, start=1):
        assert sib.id is not None
        sib.position = idx
        session.add(sib)
    session.commit()

    new_wbs_map = _svc.wbs_map_for_project(session, project_id)
    new_wbs = new_wbs_map.get(item.id, "")

    assert current.id is not None
    history_note = f"reordered {old_wbs} → {new_wbs} by {current.name or current.username}"
    session.add(
        TaskHistory(
            task_id=item.id,
            from_status_id=item.status_id,
            to_status_id=item.status_id,
            actor_id=current.id,
            note=history_note,
        )
    )
    session.commit()

    return [_task_out(s, session, wbs_map=new_wbs_map) for s in siblings]


@router.get("/defaults", response_model=TaskDefaultsOut)
def get_task_defaults(
    project_id: int,
    current: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """U4 hint endpoint: what title-only POST would default to."""
    require_project_access(project_id, current, session)
    default_status = _default_status_for_project(session, project_id)
    stage_name: str | None = None
    if default_status is not None and default_status.stage_id is not None:
        from app.statuses.models import StatusStage as _Stage

        st = session.get(_Stage, default_status.stage_id)
        stage_name = st.name if st else None
    return TaskDefaultsOut(
        project_id=project_id,
        status_id=default_status.id if default_status else None,
        status_name=default_status.name if default_status else None,
        stage_id=default_status.stage_id if default_status else None,
        stage_name=stage_name,
        start_date=date.today().isoformat(),
    )


@router.post("", response_model=TaskOut, status_code=status.HTTP_201_CREATED)
def create_task(
    body: TaskCreate,
    current: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    project = require_project_access(body.project_id, current, session)
    if current.role == "guest":
        raise HTTPException(status_code=403, detail="Guest cannot create tasks")

    # U4: title-only; title still required (non-blank).
    title = (body.title or "").strip()
    if not title:
        raise HTTPException(status_code=422, detail="Title required")

    # U4 defaults: status_id = first leaf of first Stage, start_date = today.
    status_id = body.status_id
    if status_id is None:
        default_status = _default_status_for_project(session, body.project_id)
        if default_status is None or default_status.id is None:
            raise HTTPException(status_code=422, detail="No statuses available for default")
        status_id = default_status.id
    status_obj = session.get(Status, status_id)
    if not status_obj:
        raise HTTPException(status_code=400, detail="Invalid status_id")

    start_date = body.start_date or date.today().isoformat()

    depth = 0
    if body.parent_id is not None:
        parent = session.get(Task, body.parent_id)
        if not parent or parent.project_id != body.project_id:
            raise HTTPException(status_code=400, detail="Invalid parent task")
        if parent.depth >= 2:
            raise HTTPException(status_code=400, detail="Hierarchy depth capped at 2 (Task > 1.1 > 1.1.1)")
        depth = parent.depth + 1

    # Pre-commit: same-Project + existence for blocked_by so a 400
    # never leaves an orphan Task behind.
    _validate_blocked_by(None, body.blocked_by_ids, session, project_id=body.project_id)

    assert current.id is not None
    from app.tasks import service as _svc

    task = Task(
        project_id=body.project_id,
        parent_id=body.parent_id,
        depth=depth,
        title=title,
        description_md=body.description_md,
        status_id=status_id,
        priority=body.priority,
        start_date=start_date,
        due_date=body.due_date,
        estimate_mins=body.estimate_mins,
        created_by=current.id,
        position=_svc.next_position(session, body.project_id, body.parent_id),
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
    # Blocked by (validate self/circular refs + same-Project, U4)
    _validate_blocked_by(task.id, body.blocked_by_ids, session, project_id=body.project_id)
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


class TaskTimelineItem(BaseModel):
    task_id: int
    title: str
    depth: int
    parent_id: int | None = None
    status_id: int
    status_name: str
    start_date: str
    due_date: str | None = None
    assignee_ids: list[int] = []
    is_blocked: bool = False
    position: int = 0
    wbs: str = ""
    periods: list[StatusPeriodOut] = []


class BlockedMapItem(BaseModel):
    task_id: int
    title: str
    blocked_by: list[int] = []


@router.get("/blocked-map", response_model=list[BlockedMapItem])
def get_blocked_map(
    project_id: int,
    stage_id: int | None = None,
    current: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    require_project_access(project_id, current, session)
    query = select(Task).where(Task.project_id == project_id)
    if stage_id is not None:
        stage_ids = _stage_status_ids(session, stage_id)
        if not stage_ids:
            return []
        query = query.where(Task.status_id.in_(stage_ids))  # type: ignore[attr-defined, union-attr]
    tasks = session.exec(query).all()
    result = []
    for t in tasks:
        assert t.id is not None
        bblocks = [b.blocked_by_task_id for b in session.exec(select(TaskBlockedBy).where(TaskBlockedBy.task_id == t.id)).all() if b.blocked_by_task_id is not None]
        result.append(BlockedMapItem(task_id=t.id, title=t.title, blocked_by=bblocks))
    return result


@router.get("/timeline", response_model=list[TaskTimelineItem])
def get_task_timeline(
    project_id: int,
    depth: int | None = None,
    stage_id: int | None = None,
    current: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    require_project_access(project_id, current, session)
    if not can_access_view(current.role, "timeline"):
        raise HTTPException(status_code=403, detail="Timeline view requires member+")
    return _timeline_items(session, project_id, depth=depth, stage_id=stage_id)


def _timeline_items(
    session: Session,
    project_id: int,
    depth: int | None = None,
    stage_id: int | None = None,
) -> list[TaskTimelineItem]:
    """Single definition of timeline rows (T9 depth parity with List/Board).

    Derived only from tasks.start_date + task_status_periods (SPEC-v0.2 P3).
    U5: optional stage_id narrows to tasks whose current Status sits in
    that Stage (pipeline expand / stacked-bar source stays periods).
    """
    query = select(Task).where(Task.project_id == project_id)
    if depth is not None:
        if depth not in (0, 1, 2):
            raise HTTPException(status_code=400, detail="Invalid depth (0|1|2)")
        query = query.where(Task.depth == depth)
    if stage_id is not None:
        stage_ids = _stage_status_ids(session, stage_id)
        if not stage_ids:
            return []
        query = query.where(Task.status_id.in_(stage_ids))  # type: ignore[attr-defined, union-attr]
    tasks = session.exec(query).all()
    # V1: order by sibling position so Timeline WBS pane matches List.
    from app.tasks import service as _tl_svc

    tasks = sorted(
        tasks,
        key=lambda t: (
            t.parent_id if t.parent_id is not None else -1,
            (t.position is None, t.position if t.position is not None else 0, t.id or 0),
        ),
    )
    try:
        wbs_map = _tl_svc.wbs_map_for_project(session, project_id)
    except Exception:
        wbs_map = {}
    results = []
    for t in tasks:
        assert t.id is not None
        tout = _task_out(t, session, wbs_map=wbs_map)
        st = session.get(Status, t.status_id)
        st_name = st.name if st else ""
        results.append(
            TaskTimelineItem(
                task_id=t.id,
                title=t.title,
                depth=t.depth,
                parent_id=t.parent_id,
                status_id=t.status_id,
                status_name=st_name,
                start_date=t.start_date,
                due_date=t.due_date,
                assignee_ids=tout.assignee_ids,
                is_blocked=tout.is_blocked,
                position=t.position if t.position is not None else 0,
                wbs=wbs_map.get(t.id, ""),
                periods=tout.status_periods,
            )
        )
    return results


def _timeline_export_csv(items: list[TaskTimelineItem]) -> str:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(
        [
            "task_id",
            "title",
            "depth",
            "parent_id",
            "status_id",
            "status_name",
            "start_date",
            "due_date",
            "assignee_ids",
            "is_blocked",
            "periods",
        ]
    )
    for it in items:
        periods = "; ".join(
            f"{p.status_id}:{p.start_date or ''}->{p.due_date or ''}/{p.actual_end_date or ''}"
            for p in it.periods
        )
        w.writerow(
            [
                it.task_id,
                it.title,
                it.depth,
                it.parent_id if it.parent_id is not None else "",
                it.status_id,
                it.status_name,
                it.start_date,
                it.due_date or "",
                "|".join(str(a) for a in it.assignee_ids),
                str(it.is_blocked),
                periods,
            ]
        )
    return buf.getvalue()


@router.get("/timeline/export")
def export_task_timeline(
    project_id: int,
    format: str = "json",
    depth: int | None = None,
    stage_id: int | None = None,
    current: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """Review/archive export of the execution timeline (T9).

    JSON mirrors GET /timeline; CSV flattens one row per task with periods
    summarized. Membership-gated (404) + timeline view-gated (guest 403).
    U5: depth + stage_id parity with GET /timeline.
    """
    require_project_access(project_id, current, session)
    if not can_access_view(current.role, "timeline"):
        raise HTTPException(status_code=403, detail="Timeline view requires member+")
    fmt = format.lower()
    if fmt not in ("json", "csv"):
        raise HTTPException(status_code=400, detail="Invalid format (json|csv)")
    items = _timeline_items(session, project_id, depth=depth, stage_id=stage_id)
    suffix = f"_depth{depth}" if depth is not None else ""
    if stage_id is not None:
        suffix += f"_stage{stage_id}"
    if fmt == "csv":
        return Response(
            content=_timeline_export_csv(items),
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename=timeline_project_{project_id}{suffix}.csv"},
        )
    payload = [it.model_dump() for it in items]
    return JSONResponse(
        content=payload,
        headers={"Content-Disposition": f"attachment; filename=timeline_project_{project_id}{suffix}.json"},
    )


class CalendarEventOut(BaseModel):
    task_id: int
    title: str
    date: str
    kind: str  # task_due | period_due
    status_id: int
    status_name: str = ""
    depth: int = 0
    assignee_ids: list[int] = []


class TableDefsOut(BaseModel):
    id: int
    key: str
    label: str
    type: str
    required: bool
    order: int


class TableRowOut(BaseModel):
    id: int
    project_id: int
    parent_id: int | None = None
    depth: int
    title: str
    status_id: int
    status_name: str = ""
    start_date: str
    due_date: str | None = None
    assignee_ids: list[int] = []
    watcher_ids: list[int] = []
    tag_names: list[str] = []
    blocked_by_ids: list[int] = []
    is_blocked: bool = False
    custom_fields: dict[str, str] = {}


class TableOut(BaseModel):
    project_id: int
    defs: list[TableDefsOut] = []
    rows: list[TableRowOut] = []


def _project_field_defs(session: Session, project_id: int) -> list:
    project = session.get(Project, project_id)
    if project is None:
        return []
    return list(
        session.exec(
            select(CustomFieldDef).where(
                (CustomFieldDef.profile_id == project.status_profile_id)
                | (CustomFieldDef.project_id == project.id)
            ).order_by(CustomFieldDef.order)  # type: ignore[arg-type]
        ).all()
    )


@router.get("/calendar", response_model=list[CalendarEventOut])
def get_task_calendar(
    project_id: int,
    status_id: int | None = None,
    status: int | None = None,
    stage_id: int | None = None,
    assignee_id: int | None = None,
    assignee: int | None = None,
    watcher_id: int | None = None,
    watcher: int | None = None,
    tag: str | None = None,
    blocked: bool | None = None,
    overdue: bool | None = None,
    search: str | None = None,
    depth: int | None = None,
    current: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """Calendar plots Task dues + Status Period planned dues (T8).

    Reuses the exact List filter set; view-gated to calendar (guest 403),
    membership-gated to 404 for non-members. U5: stage_id parity.
    """
    require_project_access(project_id, current, session)
    if not can_access_view(current.role, "calendar"):
        raise HTTPException(status_code=403, detail="Calendar view requires member+")
    tasks = _filtered_task_outs(
        session,
        project_id=project_id,
        stage_id=stage_id,
        status_id=status_id if status_id is not None else status,
        assignee_id=assignee_id if assignee_id is not None else assignee,
        watcher_id=watcher_id if watcher_id is not None else watcher,
        tag=tag,
        blocked=blocked,
        overdue=overdue,
        search=search,
        depth=depth,
        current=current,
    )
    events: list[CalendarEventOut] = []
    for tout in tasks:
        st = session.get(Status, tout.status_id)
        st_name = st.name if st else ""
        if tout.due_date:
            events.append(
                CalendarEventOut(
                    task_id=tout.id,
                    title=tout.title,
                    date=tout.due_date,
                    kind="task_due",
                    status_id=tout.status_id,
                    status_name=st_name,
                    depth=tout.depth,
                    assignee_ids=tout.assignee_ids,
                )
            )
        for p in tout.status_periods:
            if p.due_date:
                pst = session.get(Status, p.status_id)
                events.append(
                    CalendarEventOut(
                        task_id=tout.id,
                        title=tout.title,
                        date=p.due_date,
                        kind="period_due",
                        status_id=p.status_id,
                        status_name=pst.name if pst else st_name,
                        depth=tout.depth,
                        assignee_ids=tout.assignee_ids,
                    )
                )
    events.sort(key=lambda e: (e.date, e.task_id))
    return events


@router.get("/table", response_model=TableOut)
def get_task_table(
    project_id: int,
    status_id: int | None = None,
    status: int | None = None,
    stage_id: int | None = None,
    assignee_id: int | None = None,
    assignee: int | None = None,
    watcher_id: int | None = None,
    watcher: int | None = None,
    tag: str | None = None,
    blocked: bool | None = None,
    overdue: bool | None = None,
    search: str | None = None,
    depth: int | None = None,
    current: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """Table columns: Task + Status+dates + start + assignees + custom fields (T8).

    Reuses the exact List filter set; view-gated to table (guest 403).
    U5: stage_id parity.
    """
    require_project_access(project_id, current, session)
    if not can_access_view(current.role, "table"):
        raise HTTPException(status_code=403, detail="Table view requires member+")
    tasks = _filtered_task_outs(
        session,
        project_id=project_id,
        stage_id=stage_id,
        status_id=status_id if status_id is not None else status,
        assignee_id=assignee_id if assignee_id is not None else assignee,
        watcher_id=watcher_id if watcher_id is not None else watcher,
        tag=tag,
        blocked=blocked,
        overdue=overdue,
        search=search,
        depth=depth,
        current=current,
    )
    defs = _project_field_defs(session, project_id)
    defs_out = [
        TableDefsOut(id=d.id, key=d.key, label=d.label, type=d.type, required=d.required, order=d.order)  # type: ignore[arg-type]
        for d in defs
        if d.id is not None
    ]
    task_ids = [t.id for t in tasks]
    val_map: dict[tuple[int, int], str] = {}
    if task_ids:
        for v in session.exec(select(CustomFieldValue).where(CustomFieldValue.task_id.in_(task_ids))).all():  # type: ignore[attr-defined]
            val_map[(v.task_id, v.def_id)] = v.value
    def_id_to_key = {d.id: d.key for d in defs if d.id is not None}
    rows: list[TableRowOut] = []
    for tout in tasks:
        st = session.get(Status, tout.status_id)
        custom: dict[str, str] = {}
        for def_id, key in def_id_to_key.items():
            custom[key] = val_map.get((tout.id, def_id), "")
        rows.append(
            TableRowOut(
                id=tout.id,
                project_id=tout.project_id,
                parent_id=tout.parent_id,
                depth=tout.depth,
                title=tout.title,
                status_id=tout.status_id,
                status_name=st.name if st else "",
                start_date=tout.start_date,
                due_date=tout.due_date,
                assignee_ids=tout.assignee_ids,
                watcher_ids=tout.watcher_ids,
                tag_names=tout.tag_names,
                blocked_by_ids=tout.blocked_by_ids,
                is_blocked=tout.is_blocked,
                custom_fields=custom,
            )
        )
    return TableOut(project_id=project_id, defs=defs_out, rows=rows)


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
        publish("task.status_changed", {"task_id": task.id, "from_status_id": old_status_id, "to_status_id": task.status_id, "actor_id": current.id})
        
        # Upsert period
        period = session.exec(select(TaskStatusPeriod).where(TaskStatusPeriod.task_id == task.id, TaskStatusPeriod.status_id == task.status_id)).first()
        if not period:
            period = TaskStatusPeriod(task_id=task.id, status_id=task.status_id, start_date=task.start_date, actor_id=current.id)
            session.add(period)

    assert task.id is not None
    task_id_int: int = task.id
    if body.assignee_ids is not None:
        for a in session.exec(select(TaskAssignee).where(TaskAssignee.task_id == task.id)).all():  # type: ignore[arg-type]
            session.delete(a)
        for uid in body.assignee_ids:
            session.add(TaskAssignee(task_id=task_id_int, user_id=uid))

    if body.watcher_ids is not None:
        for w in session.exec(select(TaskWatcher).where(TaskWatcher.task_id == task.id)).all():  # type: ignore[arg-type]
            session.delete(w)
        for uid in body.watcher_ids:
            session.add(TaskWatcher(task_id=task_id_int, user_id=uid))

    if body.blocked_by_ids is not None:
        _validate_blocked_by(task_id_int, body.blocked_by_ids, session, project_id=task.project_id)
        for b in session.exec(select(TaskBlockedBy).where(TaskBlockedBy.task_id == task.id)).all():  # type: ignore[arg-type]
            session.delete(b)
        for bvid in body.blocked_by_ids:
            session.add(TaskBlockedBy(task_id=task_id_int, blocked_by_task_id=bvid))

    if body.tag_names is not None:
        for tt in session.exec(select(TaskTag).where(TaskTag.task_id == task.id)).all():  # type: ignore[arg-type]
            session.delete(tt)
        for tname in body.tag_names:
            tag_obj = session.exec(select(Tag).where(Tag.name == tname)).first()
            if not tag_obj:
                tag_obj = Tag(name=tname)
                session.add(tag_obj)
                session.commit()
                session.refresh(tag_obj)
            assert tag_obj.id is not None
            session.add(TaskTag(task_id=task_id_int, tag_id=tag_obj.id))

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
    publish("task.status_changed", {"task_id": task.id, "from_status_id": old_status_id, "to_status_id": body.status_id, "actor_id": current.id})

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


class CommentCreate(BaseModel):
    body_md: str
    parent_id: int | None = None
    mentions: list[int] = []


class CommentOut(BaseModel):
    id: int
    task_id: int
    parent_id: int | None = None
    author_id: int
    body_md: str
    mentions: list[int] = []
    created_at: str


class AttachmentOut(BaseModel):
    id: int
    task_id: int
    filename: str
    path: str
    size: int
    uploaded_by: int
    created_at: str


class CustomFieldValueOut(BaseModel):
    def_id: int
    key: str
    label: str
    type: str
    required: bool
    value: str


@router.get("/{task_id}/comments", response_model=list[CommentOut])
def list_comments(
    task_id: int,
    current: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    task = session.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    require_project_access(task.project_id, current, session)
    comments = session.exec(select(TaskComment).where(TaskComment.task_id == task_id).order_by(TaskComment.id)).all()  # type: ignore[arg-type]
    return [
        CommentOut(
            id=c.id,  # type: ignore[arg-type]
            task_id=c.task_id,
            parent_id=c.parent_id,
            author_id=c.author_id,
            body_md=c.body_md,
            mentions=_mention_ids_for_comment(c.id, session) if c.id is not None else [],  # type: ignore[arg-type]
            created_at=c.created_at,
        )
        for c in comments
    ]


@router.post("/{task_id}/comments", response_model=CommentOut, status_code=status.HTTP_201_CREATED)
def create_comment(
    task_id: int,
    body: CommentCreate,
    current: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    task = session.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    require_project_access(task.project_id, current, session)
    if body.parent_id is not None:
        parent = session.get(TaskComment, body.parent_id)
        if not parent or parent.task_id != task_id:
            raise HTTPException(status_code=400, detail="Invalid parent comment")
    for uid in body.mentions:
        if session.get(User, uid) is None:
            raise HTTPException(status_code=400, detail=f"Invalid mention user_id {uid}")
    assert current.id is not None
    comment = TaskComment(
        task_id=task_id,
        parent_id=body.parent_id,
        author_id=current.id,
        body_md=body.body_md,
    )
    session.add(comment)
    session.commit()
    session.refresh(comment)
    assert comment.id is not None
    for uid in body.mentions:
        session.add(TaskCommentMention(comment_id=comment.id, user_id=uid))
    session.commit()
    publish("task.comment_added", {"task_id": task_id, "comment_id": comment.id, "author_id": current.id})
    return CommentOut(
        id=comment.id,
        task_id=comment.task_id,
        parent_id=comment.parent_id,
        author_id=comment.author_id,
        body_md=comment.body_md,
        mentions=list(body.mentions),
        created_at=comment.created_at,
    )


@router.get("/{task_id}/attachments", response_model=list[AttachmentOut])
def list_attachments(
    task_id: int,
    current: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    task = session.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    require_project_access(task.project_id, current, session)
    atts = session.exec(select(TaskAttachment).where(TaskAttachment.task_id == task_id).order_by(TaskAttachment.id)).all()  # type: ignore[arg-type]
    return [
        AttachmentOut(
            id=a.id,  # type: ignore[arg-type]
            task_id=a.task_id,
            filename=a.filename,
            path=a.path,
            size=a.size,
            uploaded_by=a.uploaded_by,
            created_at=a.created_at,
        )
        for a in atts
    ]


@router.post("/{task_id}/attachments", response_model=AttachmentOut, status_code=status.HTTP_201_CREATED)
def upload_attachment(
    task_id: int,
    file: UploadFile = File(...),
    current: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    task = session.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    require_project_access(task.project_id, current, session)
    if current.role == "guest":
        raise HTTPException(status_code=403, detail="Guest cannot upload attachments")

    contents = file.file.read()
    size = len(contents)
    if size > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File size exceeds 10MB limit")

    upload_dir = os.environ.get("UPLOAD_DIR", "./data/uploads")
    os.makedirs(upload_dir, exist_ok=True)
    filename = os.path.basename(file.filename or "file")
    file_path = os.path.join(upload_dir, f"{task_id}_{int(datetime.now().timestamp())}_{filename}")
    with open(file_path, "wb") as f:
        f.write(contents)

    assert current.id is not None
    att = TaskAttachment(
        task_id=task_id,
        filename=filename,
        path=file_path,
        size=size,
        uploaded_by=current.id,
    )
    session.add(att)
    session.commit()
    session.refresh(att)
    assert att.id is not None
    return AttachmentOut(
        id=att.id,
        task_id=att.task_id,
        filename=att.filename,
        path=att.path,
        size=att.size,
        uploaded_by=att.uploaded_by,
        created_at=att.created_at,
    )


@router.delete("/{task_id}/attachments/{att_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_attachment(
    task_id: int,
    att_id: int,
    current: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    task = session.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    require_project_access(task.project_id, current, session)
    if current.role == "guest":
        raise HTTPException(status_code=403, detail="Guest cannot delete attachments")
    att = session.get(TaskAttachment, att_id)
    if not att or att.task_id != task_id:
        raise HTTPException(status_code=404, detail="Attachment not found")
    session.delete(att)
    session.commit()
    try:
        if att.path and os.path.isfile(att.path):
            os.remove(att.path)
    except OSError:
        pass
    return None


@router.get("/{task_id}/custom-fields", response_model=list[CustomFieldValueOut])
def get_task_custom_fields(
    task_id: int,
    current: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    task = session.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    require_project_access(task.project_id, current, session)
    project = session.get(Project, task.project_id)
    if not project:
        return []
    defs = session.exec(
        select(CustomFieldDef).where(
            (CustomFieldDef.profile_id == project.status_profile_id) | (CustomFieldDef.project_id == project.id)
        ).order_by(CustomFieldDef.order)  # type: ignore[arg-type]
    ).all()
    values = session.exec(select(CustomFieldValue).where(CustomFieldValue.task_id == task_id)).all()
    val_map = {v.def_id: v.value for v in values}
    results = []
    for d in defs:
        assert d.id is not None
        results.append(
            CustomFieldValueOut(
                def_id=d.id,
                key=d.key,
                label=d.label,
                type=d.type,
                required=d.required,
                value=val_map.get(d.id, ""),
            )
        )
    return results


@router.put("/{task_id}/custom-fields", response_model=list[CustomFieldValueOut])
def update_task_custom_fields(
    task_id: int,
    field_values: dict[int, str],
    current: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    task = session.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    require_project_access(task.project_id, current, session)
    if current.role == "guest":
        raise HTTPException(status_code=403, detail="Guest cannot update custom fields")
    project = session.get(Project, task.project_id)
    if project is not None:
        allowed_def_ids = {
            d.id
            for d in session.exec(
                select(CustomFieldDef).where(
                    (CustomFieldDef.profile_id == project.status_profile_id)
                    | (CustomFieldDef.project_id == project.id)
                )
            ).all()
            if d.id is not None
        }
        for def_id in field_values:
            if def_id not in allowed_def_ids:
                raise HTTPException(status_code=400, detail=f"Invalid custom field def_id {def_id}")

    for def_id, val in field_values.items():
        v_obj = session.exec(
            select(CustomFieldValue).where(CustomFieldValue.task_id == task_id, CustomFieldValue.def_id == def_id)
        ).first()
        if v_obj:
            v_obj.value = val
            session.add(v_obj)
        else:
            session.add(CustomFieldValue(task_id=task_id, def_id=def_id, value=val))
    session.commit()
    return get_task_custom_fields(task_id, current, session)


@router.get("/{task_id}/subtasks", response_model=list[TaskOut])
def list_subtasks(
    task_id: int,
    current: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    task = session.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    require_project_access(task.project_id, current, session)
    subtasks = session.exec(select(Task).where(Task.parent_id == task_id).order_by(Task.id)).all()  # type: ignore[arg-type]
    return [_task_out(st, session) for st in subtasks]
