from datetime import datetime, timezone

from sqlmodel import Field, SQLModel


class Category(SQLModel, table=True):
    __tablename__ = "categories"  # type: ignore[assignment]

    id: int | None = Field(default=None, primary_key=True)
    key: str = Field(unique=True, index=True, max_length=32)
    name: str = Field(unique=True, index=True, max_length=128)
    color: str = Field(default="#6b7280", max_length=32)
    status_profile_id: int | None = Field(default=None, foreign_key="status_profiles.id")
    created_by: int | None = Field(default=None, foreign_key="users.id")
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class CategoryMember(SQLModel, table=True):
    __tablename__ = "category_members"  # type: ignore[assignment]

    category_id: int | None = Field(default=None, foreign_key="categories.id", primary_key=True)
    user_id: int | None = Field(default=None, foreign_key="users.id", primary_key=True)
    role: str = Field(default="member", max_length=16)
