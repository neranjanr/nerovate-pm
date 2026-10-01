from datetime import datetime

from sqlmodel import Field, SQLModel


class User(SQLModel, table=True):
    __tablename__ = "users"  # type: ignore[assignment]

    id: int | None = Field(default=None, primary_key=True)
    username: str = Field(unique=True, index=True, min_length=2, max_length=64)
    password_hash: str
    name: str = Field(max_length=128)
    role: str = Field(default="member", max_length=16)  # admin|manager|member|guest
    active: bool = Field(default=True)
