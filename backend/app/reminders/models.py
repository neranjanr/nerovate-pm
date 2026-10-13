from datetime import datetime, timezone

from sqlmodel import Field, SQLModel


class Reminder(SQLModel, table=True):
    """Dated nudge anchored to exactly one work item (CONTEXT.md: Reminder).

    01 scope (one-time anchored core): exactly one of project_id / task_id
    is set. task_id covers Task (depth 0), Subtask (depth 1), and Microtask
    (depth 2) rows. Any Status allowed, including Complete / Cancelled.

    status: active | done | dismissed. Done and Dismiss both resolve.
    """

    __tablename__ = "reminders"  # type: ignore[assignment]

    id: int | None = Field(default=None, primary_key=True)
    title: str = Field(max_length=256)
    note: str = Field(default="", max_length=2000)
    due_at: str = Field(max_length=32)
    status: str = Field(default="active", max_length=16)
    project_id: int | None = Field(default=None, foreign_key="projects.id", index=True)
    task_id: int | None = Field(default=None, foreign_key="tasks.id", index=True)
    created_by: int | None = Field(default=None, foreign_key="users.id")
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
