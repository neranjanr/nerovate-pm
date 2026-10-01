import os

from sqlmodel import Session, SQLModel, create_engine, select

DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///./data/nrg.db")

connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, connect_args=connect_args)


def init_db() -> None:
    from app.auth import models as _auth_models  # noqa: F401
    from app.projects import models as _proj_models  # noqa: F401
    from app.statuses import models as _status_models  # noqa: F401

    SQLModel.metadata.create_all(engine)

    with Session(engine) as session:
        from app.statuses.models import CustomFieldDef, Status, StatusProfile

        if not session.exec(select(StatusProfile)).first():
            proc = StatusProfile(name="Procurement", is_template=True)
            session.add(proc)
            session.commit()
            session.refresh(proc)
            assert proc.id is not None
            for order, (sname, is_done) in enumerate(
                [
                    ("Get prior approval", False),
                    ("Prepare quotes", False),
                    ("Evaluation", False),
                    ("Closed", True),
                ],
                start=1,
            ):
                session.add(Status(profile_id=proc.id, name=sname, order=order, is_done=is_done))
            session.add(
                CustomFieldDef(
                    profile_id=proc.id,
                    project_id=None,
                    key="vendor",
                    type="text",
                    label="Vendor",
                    required=False,
                    order=1,
                )
            )

            monthly = StatusProfile(name="Monthly Repetitive", is_template=True)
            session.add(monthly)
            session.commit()
            session.refresh(monthly)
            assert monthly.id is not None
            for order, (sname, is_done) in enumerate(
                [
                    ("Due", False),
                    ("Paid", False),
                    ("Verified", False),
                    ("Closed", True),
                ],
                start=1,
            ):
                session.add(Status(profile_id=monthly.id, name=sname, order=order, is_done=is_done))
            session.add(
                CustomFieldDef(
                    profile_id=monthly.id,
                    project_id=None,
                    key="invoice_no",
                    type="text",
                    label="Invoice No",
                    required=False,
                    order=1,
                )
            )
            session.commit()
