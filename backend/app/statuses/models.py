from datetime import datetime, timezone
from sqlmodel import Field, SQLModel


class StatusProfile(SQLModel, table=True):
    __tablename__ = "status_profiles"  # type: ignore[assignment]

    id: int | None = Field(default=None, primary_key=True)
    name: str = Field(max_length=128)
    is_template: bool = Field(default=True)
    created_by: int | None = Field(default=None, foreign_key="users.id")
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class StatusStage(SQLModel, table=True):
    __tablename__ = "status_stages"  # type: ignore[assignment]

    id: int | None = Field(default=None, primary_key=True)
    profile_id: int = Field(foreign_key="status_profiles.id", index=True)
    name: str = Field(max_length=128)
    order: int = Field(default=0)
    color_base: str = Field(default="#6b7280", max_length=32)


class Status(SQLModel, table=True):
    __tablename__ = "statuses"  # type: ignore[assignment]

    id: int | None = Field(default=None, primary_key=True)
    profile_id: int = Field(foreign_key="status_profiles.id", index=True)
    stage_id: int | None = Field(default=None, foreign_key="status_stages.id", index=True)
    name: str = Field(max_length=128)
    color: str = Field(default="#6b7280", max_length=32)
    shade: str | None = Field(default=None, max_length=32)
    order: int = Field(default=0)
    is_done: bool = Field(default=False)
    is_blocked: bool = Field(default=False)


class CustomFieldDef(SQLModel, table=True):
    __tablename__ = "custom_field_defs"  # type: ignore[assignment]

    id: int | None = Field(default=None, primary_key=True)
    profile_id: int | None = Field(default=None, foreign_key="status_profiles.id", index=True)
    project_id: int | None = Field(default=None, foreign_key="projects.id", index=True)
    key: str = Field(max_length=64)
    type: str = Field(default="text", max_length=32)  # text|number|url|date|dropdown|checkbox|user
    label: str = Field(max_length=128)
    required: bool = Field(default=False)
    order: int = Field(default=0)


class CustomFieldValue(SQLModel, table=True):
    __tablename__ = "custom_field_values"  # type: ignore[assignment]

    id: int | None = Field(default=None, primary_key=True)
    task_id: int = Field(index=True)
    def_id: int = Field(foreign_key="custom_field_defs.id", index=True)
    value: str = Field(default="")
