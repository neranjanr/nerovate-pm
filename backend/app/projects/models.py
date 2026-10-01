from datetime import datetime, timezone

from sqlmodel import Field, SQLModel


class Project(SQLModel, table=True):
    __tablename__ = "projects"  # type: ignore[assignment]

    id: int | None = Field(default=None, primary_key=True)
    name: str = Field(max_length=128)
    code: str = Field(unique=True, index=True, max_length=12, min_length=2)
    description: str = Field(default="", max_length=2000)
    owner_id: int | None = Field(default=None, foreign_key="users.id")
    status_profile_id: int | None = Field(default=None)
    start_date: str | None = Field(default=None)
    target_date: str | None = Field(default=None)
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class ProjectMember(SQLModel, table=True):
    __tablename__ = "project_members"  # type: ignore[assignment]

    project_id: int | None = Field(default=None, foreign_key="projects.id", primary_key=True)
    user_id: int | None = Field(default=None, foreign_key="users.id", primary_key=True)
    role: str = Field(default="member", max_length=16)
