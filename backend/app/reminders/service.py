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


REPEAT_STEPS = ("none", "daily", "weekly", "monthly", "yearly")
REPEAT_ENDS = ("never", "after", "until")


def split_due(due_at: str) -> tuple[str, str | None]:
    """Split a due value into (date_part, time_part|None).

    Accepts date-only (YYYY-MM-DD, time defaults to 09:00 server-local)
    and datetime forms (YYYY-MM-DD[ T]HH:MM[:SS]).
    """
    v = (due_at or "").strip()
    if "T" in v:
        date_part, _, time_part = v.partition("T")
        return date_part.strip(), (time_part.strip() or None)
    if " " in v:
        date_part, _, time_part = v.partition(" ")
        return date_part.strip(), (time_part.strip() or None)
    return v, None


def normalize_due_at(due_at: str) -> str:
    """Date-only values default to 09:00 server-local (single on-prem site)."""
    import re

    v = (due_at or "").strip()
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", v):
        return f"{v}T09:00:00"
    return v


def advance_due(due_at: str, repeat: str) -> str:
    """Next due value derived from the *due date* (never completion date)."""
    import calendar
    from datetime import date

    date_part, time_part = split_due(due_at)
    y, m, d = (int(x) for x in date_part.split("-"))
    if repeat == "daily":
        base = date(y, m, d).toordinal() + 1
        nxt = date.fromordinal(base)
    elif repeat == "weekly":
        nxt = date.fromordinal(date(y, m, d).toordinal() + 7)
    elif repeat == "monthly":
        nm = m + 1
        ny = y + (nm - 1) // 12
        nm = (nm - 1) % 12 + 1
        nxt = date(ny, nm, min(d, calendar.monthrange(ny, nm)[1]))
    elif repeat == "yearly":
        if m == 2 and d == 29:
            d = 28
        nxt = date(y + 1, m, min(d, calendar.monthrange(y + 1, m)[1]))
    else:
        raise ValueError(f"Unknown repeat: {repeat}")
    out = nxt.isoformat()
    if time_part:
        out = f"{out}T{time_part}"
    return out


def chain_next(session: Session, reminder):  # type: ignore[no-untyped-def]
    """Create the next occurrence after a Done/Dismiss, or None when ended.

    End rules: never always chains; after N stops once occurrence_index+1
    reaches repeat_after_n; until stops when the next due date passes
    repeat_until. The new row copies anchor + detach context + cadence so
    detached items keep recurring.
    """
    from app.reminders.models import Reminder

    repeat = (getattr(reminder, "repeat", None) or "none").lower()
    if repeat == "none":
        return None
    next_due = advance_due(reminder.due_at, repeat)
    next_index = (getattr(reminder, "occurrence_index", 0) or 0) + 1
    end = (getattr(reminder, "repeat_end", None) or "never").lower()
    if end == "after":
        total = getattr(reminder, "repeat_after_n", None) or 0
        if next_index >= total:
            return None
    elif end == "until":
        until = (getattr(reminder, "repeat_until", None) or "").strip()
        if until and split_due(next_due)[0] > split_due(until)[0]:
            return None
    nxt = Reminder(
        title=reminder.title,
        note=reminder.note,
        due_at=next_due,
        status="active",
        project_id=reminder.project_id,
        task_id=reminder.task_id,
        ex_anchor_title=getattr(reminder, "ex_anchor_title", "") or "",
        ex_anchor_project_id=getattr(reminder, "ex_anchor_project_id", None),
        detached_at=getattr(reminder, "detached_at", None),
        created_by=reminder.created_by,
        repeat=getattr(reminder, "repeat", "none"),
        repeat_end=getattr(reminder, "repeat_end", "never"),
        repeat_after_n=getattr(reminder, "repeat_after_n", None),
        repeat_until=getattr(reminder, "repeat_until", None),
        occurrence_index=next_index,
        snoozed_until=None,
    )
    session.add(nxt)
    return nxt
