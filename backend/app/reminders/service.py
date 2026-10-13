"""Reminder follow-up + detach helpers (03).

Shared by the reminders router (fire / follow-up endpoints), the tasks
delete seam, the new project delete seam, and the category cascade so all
four delete paths detach identically: standalone (both FKs null) + kept
ex-anchor title. Generic column preservation keeps recurring (02) cadence
working on detached items.
"""

from datetime import datetime, timezone

from sqlmodel import Session, select


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def is_detached(reminder) -> bool:  # type: ignore[no-untyped-def]
    return reminder.project_id is None and reminder.task_id is None


def detach_for_tasks(
    session: Session, task_ids: list[int], titles: dict[int, str], project_id: int | None
) -> list[int]:
    """Detach reminders anchored to the given task ids.

    Returns the detached reminder ids. Never raises for missing rows;
    never deletes a Reminder.
    """
    from app.reminders.models import Reminder

    detached: list[int] = []
    for tid in task_ids:
        rows = session.exec(select(Reminder).where(Reminder.task_id == tid)).all()
        for r in rows:
            assert r.id is not None
            r.task_id = None
            r.project_id = None
            r.ex_anchor_title = (titles.get(tid) or r.title)[:256]
            r.ex_anchor_project_id = project_id
            r.detached_at = _now()
            r.updated_at = _now()
            session.add(r)
            detached.append(r.id)
    return detached


def detach_for_project(
    session: Session, project_id: int, project_name: str, task_titles: dict[int, str]
) -> list[int]:
    """Detach project-anchored + task-anchored reminders for a project delete."""
    from app.reminders.models import Reminder

    detached: list[int] = []
    for r in session.exec(select(Reminder).where(Reminder.project_id == project_id)).all():
        assert r.id is not None
        r.project_id = None
        r.task_id = None
        r.ex_anchor_title = (project_name or r.title)[:256]
        r.ex_anchor_project_id = project_id
        r.detached_at = _now()
        r.updated_at = _now()
        session.add(r)
        detached.append(r.id)
    for tid, title in task_titles.items():
        rows = session.exec(select(Reminder).where(Reminder.task_id == tid)).all()
        for r in rows:
            assert r.id is not None
            r.task_id = None
            r.project_id = None
            r.ex_anchor_title = (title or r.title)[:256]
            r.ex_anchor_project_id = project_id
            r.detached_at = _now()
            r.updated_at = _now()
            session.add(r)
            detached.append(r.id)
    return detached


def notify_user_ids(session: Session, reminder) -> list[int]:  # type: ignore[no-untyped-def]
    """Assignee + Watchers + Project Owners for a firing Reminder."""
    from app.projects.models import Project, ProjectMember
    from app.tasks.models import Task, TaskAssignee, TaskWatcher

    ids: set[int] = set()
    anchor_pid: int | None = None
    if reminder.task_id is not None:
        task = session.get(Task, reminder.task_id)
        if task is not None:
            anchor_pid = task.project_id
            for a in session.exec(
                select(TaskAssignee).where(TaskAssignee.task_id == task.id)
            ).all():
                if a.user_id is not None:
                    ids.add(a.user_id)
            for w in session.exec(
                select(TaskWatcher).where(TaskWatcher.task_id == task.id)
            ).all():
                if w.user_id is not None:
                    ids.add(w.user_id)
    elif reminder.project_id is not None:
        anchor_pid = reminder.project_id
    elif getattr(reminder, "ex_anchor_project_id", None) is not None:
        anchor_pid = reminder.ex_anchor_project_id
    if anchor_pid is not None:
        proj = session.get(Project, anchor_pid)
        if proj is not None:
            if proj.owner_id is not None:
                ids.add(proj.owner_id)
            for m in session.exec(
                select(ProjectMember).where(ProjectMember.project_id == anchor_pid)
            ).all():
                if m.user_id is not None and (m.role or "") in ("owner", "manager"):
                    ids.add(m.user_id)
    if reminder.created_by is not None:
        ids.add(reminder.created_by)
    return sorted(ids)


def source_project_id(session: Session, reminder) -> int | None:  # type: ignore[no-untyped-def]
    """Owning project for follow-up linking (original anchor, never migrated)."""
    from app.tasks.models import Task

    if reminder.task_id is not None:
        task = session.get(Task, reminder.task_id)
        return task.project_id if task is not None else None
    if reminder.project_id is not None:
        return reminder.project_id
    return getattr(reminder, "ex_anchor_project_id", None)
