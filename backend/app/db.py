import os

from sqlmodel import SQLModel, create_engine

DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///./data/nrg.db")

connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, connect_args=connect_args)


def init_db() -> None:
    from app.auth import models as _auth_models  # noqa: F401
    from app.projects import models as _proj_models  # noqa: F401

    SQLModel.metadata.create_all(engine)
