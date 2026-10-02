import os

from sqlmodel import Session, SQLModel, create_engine, select

DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///./data/nrg.db")

connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, connect_args=connect_args)


def init_db() -> None:
    from app.auth import models as _auth_models  # noqa: F401
    from app.categories import models as _cat_models  # noqa: F401
    from app.projects import models as _proj_models  # noqa: F401
    from app.statuses import models as _status_models  # noqa: F401
    from app.tasks import models as _task_models  # noqa: F401

    SQLModel.metadata.create_all(engine)
    _migrate_projects_category_scope()

    with Session(engine) as session:
        from app.auth.models import User
        from app.security import hash_password
        from app.statuses.models import CustomFieldDef, Status, StatusProfile

        # Default admin account (admin/admin). Seeded once when the users
        # table is empty; change the password after first login.
        # Override via DEFAULT_ADMIN_PASSWORD env if needed.
        if not session.exec(select(User)).first():
            session.add(
                User(
                    username=os.environ.get("DEFAULT_ADMIN_USERNAME", "admin"),
                    password_hash=hash_password(os.environ.get("DEFAULT_ADMIN_PASSWORD", "admin")),
                    name="Admin",
                    role="admin",
                    active=True,
                )
            )
            session.commit()

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


def _migrate_projects_category_scope() -> None:
    """U2 additive migration: nullable category_id -> backfill -> scoped uniques.

    - Adds projects.category_id when missing (older sqlite files).
    - Backfills one Category per legacy Project (key=CAT-<CODE>, same
      name/color default), preserving code (now scoped), and copies
      project_members -> category_members so old data stays reachable.
    - Drops the pre-U2 global UNIQUE on projects.code when it exists
      (table rebuild, data-preserving) so the same code can repeat
      across Categories.
    - Creates UNIQUE(category_id, code) + UNIQUE(category_id, name).
    Idempotent: safe to run on every boot and in tests.
    """
    from sqlalchemy import text

    from datetime import datetime, timezone

    def _now() -> str:
        return datetime.now(timezone.utc).isoformat()

    with Session(engine) as session:
        cols = [r[1] for r in session.execute(text("PRAGMA table_info(projects)")).all()]
        if not cols:
            return
        if "category_id" not in cols:
            session.execute(text("ALTER TABLE projects ADD COLUMN category_id INTEGER"))
            session.commit()

        # Drop pre-U2 global unique on code alone (autoindex or named).
        try:
            idx_rows = session.execute(text("PRAGMA index_list(projects)")).all()
            for idx in idx_rows:
                # (seq, name, unique, origin, partial)
                iname = idx[1]
                is_unique = bool(idx[2])
                if not is_unique or iname.startswith("uq_projects_category_"):
                    continue
                try:
                    info = session.execute(text(f'PRAGMA index_info("{iname}")')).all()
                    if len(info) == 1:
                        session.execute(text(f'DROP INDEX IF EXISTS "{iname}"'))
                        session.commit()
                except Exception:
                    pass
        except Exception:
            pass

        # Backfill legacy rows with NULL category_id.
        try:
            legacy_rows = session.execute(
                text("SELECT id, name, code, owner_id FROM projects WHERE category_id IS NULL")
            ).all()
        except Exception:
            legacy_rows = []
        for pid, pname, pcode, owner_id in legacy_rows:
            code = (pcode or "PRJ").strip().upper() or "PRJ"
            base_key = f"CAT-{code}"[:16]
            key = base_key
            suffix = 2
            while session.execute(text("SELECT 1 FROM categories WHERE key = :k").bindparams(k=key)).first():
                tail = f"-{suffix}"
                key = (base_key[: 16 - len(tail)] + tail) if len(base_key + tail) > 16 else (base_key + tail)
                suffix += 1
            cname = pname or f"Category {code}"
            cname_try = cname
            n = 2
            while session.execute(text("SELECT 1 FROM categories WHERE name = :n").bindparams(n=cname_try)).first():
                cname_try = f"{cname} {code}" if n == 2 else f"{cname} {code} {n}"
                n += 1
            session.execute(
                text(
                    "INSERT INTO categories (key, name, color, created_at)"
                    " VALUES (:k, :n, '#6b7280', :t)"
                ).bindparams(k=key, n=cname_try, t=_now())
            )
            session.commit()
            cat_id = session.execute(text("SELECT id FROM categories WHERE key = :k").bindparams(k=key)).one()[0]
            session.execute(
                text("UPDATE projects SET category_id = :c WHERE id = :p").bindparams(c=cat_id, p=pid)
            )
            session.commit()
            # Carry membership so old data stays reachable via category union.
            try:
                members = session.execute(
                    text("SELECT user_id, role FROM project_members WHERE project_id = :p").bindparams(p=pid)
                ).all()
                for uid, role in members:
                    if session.execute(
                        text(
                            "SELECT 1 FROM category_members WHERE category_id = :c AND user_id = :u"
                        ).bindparams(c=cat_id, u=uid)
                    ).first():
                        continue
                    session.execute(
                        text(
                            "INSERT INTO category_members (category_id, user_id, role)"
                            " VALUES (:c, :u, :r)"
                        ).bindparams(c=cat_id, u=uid, r=role or "member")
                    )
                if owner_id is not None and not session.execute(
                    text(
                        "SELECT 1 FROM category_members WHERE category_id = :c AND user_id = :u"
                    ).bindparams(c=cat_id, u=owner_id)
                ).first():
                    session.execute(
                        text(
                            "INSERT INTO category_members (category_id, user_id, role)"
                            " VALUES (:c, :u, 'manager')"
                        ).bindparams(c=cat_id, u=owner_id)
                    )
                session.commit()
            except Exception:
                pass

        # Scoped uniques (IF NOT EXISTS keeps reruns cheap).
        for idx_name, cols_pair in (
            ("uq_projects_category_code", "(category_id, code)"),
            ("uq_projects_category_name", "(category_id, name)"),
        ):
            try:
                session.execute(text(f"CREATE UNIQUE INDEX IF NOT EXISTS {idx_name} ON projects {cols_pair}"))
                session.commit()
            except Exception:
                pass
