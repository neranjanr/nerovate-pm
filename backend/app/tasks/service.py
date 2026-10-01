"""Reusable task queries (SPEC-v0.2 section 7 rule 5).

Dashboard and future modules (gantt, mindmap) must call these helpers
instead of joining into task tables directly. The tasks router itself
uses them too so there is exactly one definition of blocked/overdue.
"""

from sqlmodel import Session, select

from app.tasks.models import Task, TaskAssignee, TaskBlockedBy


def get_project_tasks(session: Session, project_id: int) -> list[Task]:
    return list(
        session.exec(select(Task).where(Task.project_id == project_id).order_by(Task.id)).all()  # type: ignore[arg-type]
    )


def is_done_status(session: Session, status_id: int) -> bool:
    from app.statuses.models import Status

    st = session.get(Status, status_id)
    return bool(st and st.is_done)


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
