"""Dashboard read models (SPEC-v0.2 section 4.5).

Dashboard owns no task tables of its own: every number here is derived
via app.tasks.service helpers (modularity contract rule 5).
"""

from datetime import date, timedelta

from sqlmodel import Session

from app.tasks import service as tasks_service


def _day_bounds() -> tuple[str, str]:
    today = date.today()
    return today.isoformat(), (today + timedelta(days=7)).isoformat()


def summarize(session: Session, project_id: int) -> dict:
    today, soon = _day_bounds()
    tasks = tasks_service.get_project_tasks(session, project_id)

    profile_id = _profile_id(session, project_id)
    statuses = tasks_service.list_statuses_for_profile(session, profile_id) if profile_id else []

    by_status: dict[str, int] = {}
    overdue = 0
    due_soon = 0
    blocked = 0
    est_total = 0
    spent_total = 0
    for t in tasks:
        by_status[str(t.status_id)] = by_status.get(str(t.status_id), 0) + 1
        if tasks_service.task_is_overdue(session, t, today):
            overdue += 1
        if tasks_service.task_is_due_soon(session, t, today, soon):
            due_soon += 1
        if tasks_service.task_is_blocked(session, t):
            blocked += 1
        est_total += t.estimate_mins or 0
        spent_total += t.time_spent_mins or 0

    task_ids = [t.id for t in tasks if t.id is not None]
    periods = tasks_service.list_periods_for_tasks(session, task_ids)
    comments = tasks_service.list_comments_for_tasks(session, task_ids)
    atts = tasks_service.list_attachments_for_tasks(session, task_ids)

    return {
        "project_id": project_id,
        "total": len(tasks),
        "by_status": by_status,
        "statuses": [
            {"id": s.id, "name": s.name, "color": s.color, "order": s.order, "is_done": s.is_done}
            for s in sorted(statuses, key=lambda s: s.order)
        ],
        "overdue": overdue,
        "due_soon": due_soon,
        "blocked": blocked,
        "estimate_mins": est_total,
        "time_spent_mins": spent_total,
        "telemetry": {
            "tasks_total": len(tasks),
            "periods_total": len(periods),
            "comments_total": len(comments),
            "attachments_count": len(atts),
            "attachments_bytes": sum(a.size or 0 for a in atts),
        },
    }


def workload(session: Session, project_id: int) -> list[dict]:
    """Per-user open/overdue rows from task assignees (SPEC 4.5 summary.workload)."""
    from app.auth.models import User

    today, _soon = _day_bounds()
    tasks = tasks_service.get_project_tasks(session, project_id)
    per_user: dict[int, dict] = {}
    for t in tasks:
        assert t.id is not None
        done = tasks_service.is_done_status(session, t.status_id)
        over = tasks_service.task_is_overdue(session, t, today)
        for uid in tasks_service.task_assignee_ids(session, t.id):
            row = per_user.setdefault(uid, {"user_id": uid, "open": 0, "overdue": 0, "blocked": 0, "total": 0})
            row["total"] += 1
            if not done:
                row["open"] += 1
            if over:
                row["overdue"] += 1
            if not done and tasks_service.task_is_blocked(session, t):
                row["blocked"] += 1
    results = []
    for uid, row in sorted(per_user.items()):
        user = session.get(User, uid)
        results.append(
            {
                **row,
                "username": user.username if user else f"user-{uid}",
                "name": user.name if user else f"user-{uid}",
            }
        )
    return results


def activity(session: Session, project_id: int, limit: int = 30) -> list[dict]:
    """Merged project audit stream: task.status_changed + task.comment_added."""
    tasks = tasks_service.get_project_tasks(session, project_id)
    task_ids = [t.id for t in tasks if t.id is not None]
    if not task_ids:
        return []
    hist = tasks_service.list_history_for_tasks(session, task_ids)
    comments = tasks_service.list_comments_for_tasks(session, task_ids)
    events: list[dict] = [
        {
            "kind": "task.status_changed",
            "task_id": h.task_id,
            "from_status_id": h.from_status_id,
            "to_status_id": h.to_status_id,
            "actor_id": h.actor_id,
            "at": h.at,
        }
        for h in hist
    ]
    events.extend(
        {
            "kind": "task.comment_added",
            "task_id": c.task_id,
            "comment_id": c.id,
            "author_id": c.author_id,
            "body_md": (c.body_md or "")[:280],
            "at": c.created_at,
        }
        for c in comments
    )
    events.sort(key=lambda e: str(e.get("at") or ""), reverse=True)
    return events[: max(1, min(limit, 200))]


def storage_info(project_id: int) -> dict:
    """On-prem storage card: sqlite bytes + uploads bytes (never raises)."""
    import os

    from app import db as db_module

    db_bytes = 0
    try:
        url = getattr(db_module, "DATABASE_URL", "sqlite:///./data/nrg.db")
        path = url.split("sqlite:///", 1)[-1].split("?", 1)[0] if "sqlite" in url else ""
        if path == ":memory:" or not path:
            db_bytes = 0
        elif os.path.isfile(path):
            db_bytes = os.path.getsize(path)
    except OSError:
        db_bytes = 0

    upload_dir = os.environ.get("UPLOAD_DIR", "./data/uploads")
    uploads_bytes = 0
    uploads_count = 0
    try:
        for _root, _dirs, files in os.walk(upload_dir):
            for fn in files:
                fp = os.path.join(_root, fn)
                try:
                    uploads_bytes += os.path.getsize(fp)
                    uploads_count += 1
                except OSError:
                    continue
    except OSError:
        pass
    return {
        "project_id": project_id,
        "db_bytes": db_bytes,
        "uploads_bytes": uploads_bytes,
        "uploads_count": uploads_count,
        "backup_note": "Nightly sqlite3 .backup + tar of /data (db + uploads)",
    }


def _profile_id(session: Session, project_id: int) -> int | None:
    from app.projects.models import Project

    project = session.get(Project, project_id)
    return project.status_profile_id if project else None
