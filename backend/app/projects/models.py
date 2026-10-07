from datetime import datetime, timezone

from sqlalchemy import UniqueConstraint
from sqlmodel import Field, SQLModel


class Project(SQLModel, table=True):
    __tablename__ = "projects"  # type: ignore[assignment]
    __table_args__ = (
        UniqueConstraint("category_id", "code", name="uq_projects_category_code"),
        UniqueConstraint("category_id", "name", name="uq_projects_category_name"),
    )

    id: int | None = Field(default=None, primary_key=True)
    # U2: parent Category. Nullable at the column level so pre-U2 rows
    # survive; backfilled to NOT NULL logically by init_db migration.
    category_id: int | None = Field(default=None, foreign_key="categories.id", index=True)
    name: str = Field(max_length=128)
    code: str = Field(index=True, max_length=12, min_length=2)
    description: str = Field(default="", max_length=2000)
    color: str = Field(default="#6b7280", max_length=32)
    owner_id: int | None = Field(default=None, foreign_key="users.id")
    # Retained nullable unused for back-compat (SPEC-v0.3 4.2); Status Profile
    # is resolved via parent Category.
    status_profile_id: int | None = Field(default=None)
    start_date: str | None = Field(default=None)
    target_date: str | None = Field(default=None)
    # High-level lifecycle state, independent of Task Statuses (CONTEXT.md:
    # Project Status). Fixed set: Not Started | Active | Complete. Default
    # Active per grill decision; free transitions, label only.
    project_status: str = Field(default="Active", max_length=16)
    # V1 (Phase 4): per-Project default tree depth. Fixed set:
    # tasks-only | tasks-subtasks | all. Default all.
    tree_default: str = Field(default="all", max_length=16)
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class ProjectMember(SQLModel, table=True):
    __tablename__ = "project_members"  # type: ignore[assignment]

    project_id: int | None = Field(default=None, foreign_key="projects.id", primary_key=True)
    user_id: int | None = Field(default=None, foreign_key="users.id", primary_key=True)
    role: str = Field(default="member", max_length=16)


class ProjectLink(SQLModel, table=True):
    """Cross-Category relates-to / continues-as ref (SPEC-v0.3 4.2).

    Plain link only: no date rollup, no cross-Project blocking, no
    Timeline merge. CRUD endpoints land with U6; table is created here
    so U2 migration carries it.
    """

    __tablename__ = "project_links"  # type: ignore[assignment]
    __table_args__ = (
        UniqueConstraint(
            "from_project_id", "to_project_id", "kind", name="uq_project_links_pair_kind"
        ),
    )

    id: int | None = Field(default=None, primary_key=True)
    from_project_id: int | None = Field(default=None, foreign_key="projects.id", index=True)
    to_project_id: int | None = Field(default=None, foreign_key="projects.id", index=True)
    kind: str = Field(default="relates-to", max_length=16)
    note: str = Field(default="", max_length=2000)
    created_by: int | None = Field(default=None, foreign_key="users.id")
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
