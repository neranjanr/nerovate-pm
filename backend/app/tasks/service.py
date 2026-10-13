"""Reusable task queries (SPEC-v0.2 section 7 rule 5).

Dashboard and future modules (gantt, mindmap) must call these helpers
instead of joining into task tables directly. The tasks router itself
uses them too so there is exactly one definition of blocked/overdue.
"""

from sqlmodel import Session, select

from app.tasks.models import Task, TaskAssignee, TaskBlockedBy


def get_project_tasks(session: Session, project_id: int) -> list[Task]:
    return ordered_siblings(session, project_id, None, project_wide=True)


# V1 (Phase 4): persistent sibling order + WBS numbering.
#
# Order is global per parent, independent of Status/Assignee/Stage. WBS is
# a pure function of ordered sibling lists: Task N, Subtask N.M,
# Microtask N.M.K. Position is 1-based rank per parent scope.


def ordered_siblings(
    session: Session, project_id: int, parent_id: int | None, project_wide: bool = False
) -> list[Task]:
    """Siblings under one parent ordered by (position, id).

    NULL positions sort last so legacy rows stay readable pre-backfill.
    project_wide=True returns every task in the project (for WBS maps).
    """
    from sqlalchemy import func

    if project_wide:
        q = select(Task).where(Task.project_id == project_id)
    elif parent_id is None:
        q = select(Task).where(Task.project_id == project_id, Task.parent_id == None)  # type: ignore[comparison-overlap, union-attr]
    else:
        q = select(Task).where(Task.project_id == project_id, Task.parent_id == parent_id)
    rows = list(session.exec(q).all())
    rows.sort(key=lambda t: ((t.position is None, t.position if t.position is not None else 0, t.id or 0)))
    return rows


def next_position(session: Session, project_id: int, parent_id: int | None) -> int:
    from sqlalchemy import func

    mx: int | None = None
    if parent_id is None:
        mx = session.exec(
            select(func.max(Task.position)).where(Task.project_id == project_id, Task.parent_id == None)  # type: ignore[comparison-overlap, union-attr, arg-type]
        ).one()
    else:
        mx = session.exec(
            select(func.max(Task.position)).where(Task.project_id == project_id, Task.parent_id == parent_id)
        ).one()
    return (int(mx) + 1) if mx is not None else 1


def wbs_map_for_project(session: Session, project_id: int) -> dict[int, str]:
    """WBS per task id for one project, derived from position order."""
    tops = ordered_siblings(session, project_id, None)
    out: dict[int, str] = {}
    for i, top in enumerate(tops, start=1):
        assert top.id is not None
        out[top.id] = str(i)
        subs = ordered_siblings(session, project_id, top.id)
        for j, sub in enumerate(subs, start=1):
            assert sub.id is not None
            out[sub.id] = f"{i}.{j}"
            micros = ordered_siblings(session, project_id, sub.id)
            for k, mic in enumerate(micros, start=1):
                assert mic.id is not None
                out[mic.id] = f"{i}.{j}.{k}"
    return out


def wbs_for_task(session: Session, task: Task) -> str:
    """WBS for a single task (fallback when no precomputed map)."""
    assert task.id is not None
    m = wbs_map_for_project(session, task.project_id)
    return m.get(task.id, "")


def is_done_status(session: Session, status_id: int | None) -> bool:
    """Done = leaf Status flagged is_done. None (directly-assigned empty
    Stage, ADR-0010) is never done."""
    if status_id is None:
        return False
    from app.statuses.models import Status

    st = session.get(Status, status_id)
    return bool(st and st.is_done)


def stage_id_for_task(session: Session, task: Task) -> int | None:
    """Owning Stage of a task: direct stage_id for ADR-0010 empty-Stage
    assignments, else the stage of its leaf Status."""
    direct = getattr(task, "stage_id", None)
    if direct is not None:
        return direct
    if task.status_id is None:
        return None
    from app.statuses.models import Status

    st = session.get(Status, task.status_id)
    return st.stage_id if st else None


def task_blocker_ids(session: Session, task_id: int) -> list[int]:
    rows = session.exec(select(TaskBlockedBy).where(TaskBlockedBy.task_id == task_id)).all()
    return [r.blocked_by_task_id for r in rows if r.blocked_by_task_id is not None]


def task_is_blocked(session: Session, task: Task) -> bool:
    """Blocked = at least one blocked_by dependency whose status is not done."""
    assert task.id is not None
    for blocker_id in task_blocker_ids(session, task.id):
        blocker = session.get(Task, blocker_id)
        if blocker is not None and not is_done_status(session, blocker.status_id):
            return True
    return False


def task_is_overdue(session: Session, task: Task, today: str) -> bool:
    """Overdue = has a due_date before today and status is not done."""
    if not task.due_date:
        return False
    if task.due_date[:10] >= today:
        return False
    return not is_done_status(session, task.status_id)


def task_is_due_soon(session: Session, task: Task, today: str, soon: str) -> bool:
    if not task.due_date:
        return False
    due = task.due_date[:10]
    if not (today <= due <= soon):
        return False
    return not is_done_status(session, task.status_id)


def task_assignee_ids(session: Session, task_id: int) -> list[int]:
    rows = session.exec(select(TaskAssignee).where(TaskAssignee.task_id == task_id)).all()
    return [r.user_id for r in rows if r.user_id is not None]


# Bulk readers for dashboard-style consumers (modularity contract rule 5:
# other modules call these instead of selecting into task tables directly).


def list_history_for_tasks(session: Session, task_ids: list[int]) -> list:
    from app.tasks.models import TaskHistory

    if not task_ids:
        return []
    return list(session.exec(select(TaskHistory).where(TaskHistory.task_id.in_(task_ids))).all())  # type: ignore[attr-defined]


def list_comments_for_tasks(session: Session, task_ids: list[int]) -> list:
    from app.tasks.models import TaskComment

    if not task_ids:
        return []
    return list(session.exec(select(TaskComment).where(TaskComment.task_id.in_(task_ids))).all())  # type: ignore[attr-defined]


def list_periods_for_tasks(session: Session, task_ids: list[int]) -> list:
    from app.tasks.models import TaskStatusPeriod

    if not task_ids:
        return []
    return list(session.exec(select(TaskStatusPeriod).where(TaskStatusPeriod.task_id.in_(task_ids))).all())  # type: ignore[attr-defined]


def list_attachments_for_tasks(session: Session, task_ids: list[int]) -> list:
    from app.tasks.models import TaskAttachment

    if not task_ids:
        return []
    return list(session.exec(select(TaskAttachment).where(TaskAttachment.task_id.in_(task_ids))).all())  # type: ignore[attr-defined]


def list_statuses_for_profile(session: Session, profile_id: int) -> list:
    from app.statuses.models import Status

    return list(session.exec(select(Status).where(Status.profile_id == profile_id).order_by(Status.order)).all())  # type: ignore[arg-type]
