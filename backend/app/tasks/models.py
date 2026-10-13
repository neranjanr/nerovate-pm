from datetime import datetime, timezone
from sqlmodel import Field, SQLModel


class TaskBlockedBy(SQLModel, table=True):
    __tablename__ = "task_blocked_by"  # type: ignore[assignment]

    task_id: int = Field(foreign_key="tasks.id", primary_key=True)
    blocked_by_task_id: int = Field(foreign_key="tasks.id", primary_key=True)


class TaskAssignee(SQLModel, table=True):
    __tablename__ = "task_assignees"  # type: ignore[assignment]

    task_id: int = Field(foreign_key="tasks.id", primary_key=True)
    user_id: int = Field(foreign_key="users.id", primary_key=True)


class TaskWatcher(SQLModel, table=True):
    __tablename__ = "task_watchers"  # type: ignore[assignment]

    task_id: int = Field(foreign_key="tasks.id", primary_key=True)
    user_id: int = Field(foreign_key="users.id", primary_key=True)


class Tag(SQLModel, table=True):
    __tablename__ = "tags"  # type: ignore[assignment]

    id: int | None = Field(default=None, primary_key=True)
    name: str = Field(unique=True, index=True, max_length=64)


class TaskTag(SQLModel, table=True):
    __tablename__ = "task_tags"  # type: ignore[assignment]

    task_id: int = Field(foreign_key="tasks.id", primary_key=True)
    tag_id: int = Field(foreign_key="tags.id", primary_key=True)


class Task(SQLModel, table=True):
    __tablename__ = "tasks"  # type: ignore[assignment]

    id: int | None = Field(default=None, primary_key=True)
    project_id: int = Field(foreign_key="projects.id", index=True)
    parent_id: int | None = Field(default=None, foreign_key="tasks.id", index=True)
    depth: int = Field(default=0)  # 0=Task, 1=Subtask, 2=Microtask
    # V1 (Phase 4): persistent sibling rank per parent scope (per-Project for
    # Tasks, per-Task for Subtasks, per-Subtask for Microtasks). Nullable at
    # the column level so pre-V1 rows survive; backfilled in id order by
    # init_db migration, then assigned max+1 on create.
    position: int | None = Field(default=None, index=True)
    title: str = Field(max_length=256)
    description_md: str = Field(default="", max_length=10000)
    # ADR-0010: exactly one assignable node is set. Leaf assignment uses
    # status_id; direct assignment onto an empty Stage (zero Statuses) uses
    # stage_id with status_id NULL. Non-empty Stages are never assignable.
    status_id: int | None = Field(default=None, foreign_key="statuses.id", index=True)
    stage_id: int | None = Field(default=None, foreign_key="status_stages.id", index=True)
    priority: str = Field(default="normal", max_length=32)  # urgent|high|normal|low
    start_date: str = Field(max_length=32)  # whole process start
    due_date: str | None = Field(default=None, max_length=32)
    estimate_mins: int | None = Field(default=None)
    time_spent_mins: int = Field(default=0)
    created_by: int | None = Field(default=None, foreign_key="users.id")
    updated_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class TaskHistory(SQLModel, table=True):
    __tablename__ = "task_history"  # type: ignore[assignment]

    id: int | None = Field(default=None, primary_key=True)
    task_id: int = Field(foreign_key="tasks.id", index=True)
    from_status_id: int | None = Field(default=None, foreign_key="statuses.id")
    to_status_id: int | None = Field(default=None, foreign_key="statuses.id")
    # ADR-0010: stage legs of a move. from_stage_id is set when leaving a
    # directly-assigned empty Stage; to_stage_id when entering one.
    from_stage_id: int | None = Field(default=None, foreign_key="status_stages.id")
    to_stage_id: int | None = Field(default=None, foreign_key="status_stages.id")
    actor_id: int | None = Field(default=None, foreign_key="users.id")
    at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    # V1 (Phase 4): lightweight reorder audit, e.g. "reordered 1.2 -> 1.4 by X".
    # Status-change rows leave this empty; reorder rows keep from==to status.
    note: str | None = Field(default=None, max_length=512)


class TaskStatusPeriod(SQLModel, table=True):
    __tablename__ = "task_status_periods"  # type: ignore[assignment]

    id: int | None = Field(default=None, primary_key=True)
    task_id: int = Field(foreign_key="tasks.id", index=True)
    status_id: int = Field(foreign_key="statuses.id", index=True)
    start_date: str | None = Field(default=None, max_length=32)
    due_date: str | None = Field(default=None, max_length=32)  # planned end
    actual_end_date: str | None = Field(default=None, max_length=32)
    actor_id: int | None = Field(default=None, foreign_key="users.id")
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class TaskComment(SQLModel, table=True):
    __tablename__ = "task_comments"  # type: ignore[assignment]

    id: int | None = Field(default=None, primary_key=True)
    task_id: int = Field(foreign_key="tasks.id", index=True)
    parent_id: int | None = Field(default=None, foreign_key="task_comments.id")
    author_id: int = Field(foreign_key="users.id")
    body_md: str = Field(default="", max_length=10000)
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class TaskAttachment(SQLModel, table=True):
    __tablename__ = "task_attachments"  # type: ignore[assignment]

    id: int | None = Field(default=None, primary_key=True)
    task_id: int = Field(foreign_key="tasks.id", index=True)
    filename: str = Field(max_length=256)
    path: str = Field(max_length=512)
    size: int = Field(default=0)
    uploaded_by: int = Field(foreign_key="users.id")
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class TaskCommentMention(SQLModel, table=True):
    __tablename__ = "task_comment_mentions"  # type: ignore[assignment]

    comment_id: int = Field(foreign_key="task_comments.id", primary_key=True)
    user_id: int = Field(foreign_key="users.id", primary_key=True)
