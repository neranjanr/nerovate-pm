import os

from sqlmodel import Session, SQLModel, create_engine, select

DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///./data/nerovate.db")

connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, connect_args=connect_args)


def _sqlite_path(url: str) -> str:
    if "sqlite" not in url:
        return ""
    return url.split("sqlite:///", 1)[-1].split("?", 1)[0]


def _legacy_path_for(target_path: str) -> str | None:
    """Map a nerovate.db path back to its legacy nrg.db sibling."""
    if not target_path or target_path == ":memory:":
        return None
    if target_path.endswith("nerovate.db"):
        return target_path[: -len("nerovate.db")] + "nrg.db"
    return None


def migrate_legacy_db(target_url: str | None = None, source_path: str | None = None) -> bool:
    """Copy legacy nrg.db -> nerovate.db when the target is missing.

    Idempotent: returns True only when a copy happened. Copies WAL
    sidecars (-wal/-shm/-journal) when present. Never overwrites an
    existing target. Safe to call on every boot and in tests.
    """
    import shutil

    target_path = _sqlite_path(target_url or DATABASE_URL)
    if not target_path or target_path == ":memory:":
        return False
    legacy = source_path or _legacy_path_for(target_path)
    if not legacy:
        return False
    if os.path.isfile(target_path) or not os.path.isfile(legacy):
        return False
    try:
        parent = os.path.dirname(target_path)
        if parent:
            os.makedirs(parent, exist_ok=True)
        shutil.copy2(legacy, target_path)
        for suffix in ("-wal", "-shm", "-journal"):
            sidecar = legacy + suffix
            if os.path.isfile(sidecar) and not os.path.isfile(target_path + suffix):
                try:
                    shutil.copy2(sidecar, target_path + suffix)
                except OSError:
                    pass
        return True
    except OSError:
        return False


def init_db() -> None:
    migrate_legacy_db()
    from app.auth import models as _auth_models  # noqa: F401
    from app.categories import models as _cat_models  # noqa: F401
    from app.projects import models as _proj_models  # noqa: F401
    from app.statuses import models as _status_models  # noqa: F401
    from app.tasks import models as _task_models  # noqa: F401

    SQLModel.metadata.create_all(engine)
    _migrate_projects_category_scope()
    _migrate_project_status()
    _migrate_project_color()
    _migrate_project_tree_default()
    _migrate_task_position_column()
    _migrate_task_history_note()
    _migrate_status_stages()
    _migrate_status_kind()

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

        if session.exec(select(StatusProfile).where(StatusProfile.name == "Procurement")).first() is None:
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
            session.commit()

        if session.exec(select(StatusProfile).where(StatusProfile.name == "Monthly Repetitive")).first() is None:
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

    _migrate_status_stages()
    _migrate_status_kind()


def _migrate_status_kind() -> None:
    """Status-glyph-weight additive migration: statuses.kind + backfill.

    - Adds statuses.kind when missing (older sqlite files), default normal.
    - Backfills legacy is_blocked rows to kind blocked; NULL/unknown to normal.
    - Enforcement for fresh DBs comes from the model CHECK constraint;
      legacy files rely on API validation (SQLite cannot ADD CONSTRAINT).
    Idempotent: safe to run on every boot and in tests.
    """
    from sqlalchemy import text

    with Session(engine) as session:
        try:
            cols = [r[1] for r in session.execute(text("PRAGMA table_info(statuses)")).all()]
        except Exception:
            return
        if not cols:
            return
        if "kind" not in cols:
            try:
                session.execute(
                    text("ALTER TABLE statuses ADD COLUMN kind VARCHAR(16) DEFAULT 'normal'")
                )
                session.commit()
            except Exception:
                return
        try:
            session.execute(
                text("UPDATE statuses SET kind='blocked' WHERE is_blocked = 1 AND (kind IS NULL OR kind = 'normal')")
            )
            session.commit()
        except Exception:
            pass
        try:
            session.execute(text("UPDATE statuses SET kind='normal' WHERE kind IS NULL"))
            session.commit()
        except Exception:
            pass
        try:
            session.execute(
                text(
                    "UPDATE statuses SET kind='normal' WHERE kind NOT IN "
                    "('normal','on_hold','blocked','attention','cancelled')"
                )
            )
            session.commit()
        except Exception:
            pass


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
                session.commit()
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


def _migrate_project_status() -> None:
    """Additive migration for Project Status (grill decision).

    - Adds projects.project_status when missing (older sqlite files).
    - Backfills NULL/empty to 'Active' (new-project default).
    - Normalizes any legacy value outside {Not Started, Active, Complete}
      to 'Active'. Label only: no task changes.
    Idempotent.
    """
    from sqlalchemy import text

    with Session(engine) as session:
        try:
            cols = [r[1] for r in session.execute(text("PRAGMA table_info(projects)")).all()]
        except Exception:
            return
        if not cols:
            return
        if "project_status" not in cols:
            try:
                session.execute(text("ALTER TABLE projects ADD COLUMN project_status VARCHAR(16) DEFAULT 'Active'"))
                session.commit()
            except Exception:
                return
        try:
            session.execute(text("UPDATE projects SET project_status='Active' WHERE project_status IS NULL OR project_status=''"))
            session.commit()
        except Exception:
            pass
        try:
            session.execute(
                text("UPDATE projects SET project_status='Active' WHERE project_status NOT IN ('Not Started','Active','Complete')")
            )
            session.commit()
        except Exception:
            pass


def _migrate_project_color() -> None:
    """Additive migration for Project display color.

    - Adds projects.color when missing (older sqlite files).
    - Backfills NULL/empty to '#6b7280' (category default).
    Idempotent.
    """
    from sqlalchemy import text

    with Session(engine) as session:
        try:
            cols = [r[1] for r in session.execute(text("PRAGMA table_info(projects)")).all()]
        except Exception:
            return
        if not cols:
            return
        if "color" not in cols:
            try:
                session.execute(text("ALTER TABLE projects ADD COLUMN color VARCHAR(32) DEFAULT '#6b7280'"))
                session.commit()
            except Exception:
                return
        try:
            session.execute(text("UPDATE projects SET color='#6b7280' WHERE color IS NULL OR color=''"))
            session.commit()
        except Exception:
            pass


TREE_DEFAULTS = ("tasks-only", "tasks-subtasks", "all")


def _migrate_project_tree_default() -> None:
    """V1 additive migration for Project tree default (Phase 4).

    - Adds projects.tree_default when missing (older sqlite files).
    - Backfills NULL/empty to 'all'; normalizes unknown values to 'all'.
    Idempotent.
    """
    from sqlalchemy import text

    with Session(engine) as session:
        try:
            cols = [r[1] for r in session.execute(text("PRAGMA table_info(projects)")).all()]
        except Exception:
            return
        if not cols:
            return
        if "tree_default" not in cols:
            try:
                session.execute(
                    text("ALTER TABLE projects ADD COLUMN tree_default VARCHAR(16) DEFAULT 'all'")
                )
                session.commit()
            except Exception:
                return
        try:
            session.execute(
                text("UPDATE projects SET tree_default='all' WHERE tree_default IS NULL OR tree_default=''")
            )
            session.commit()
        except Exception:
            pass
        try:
            session.execute(
                text("UPDATE projects SET tree_default='all' WHERE tree_default NOT IN ('tasks-only','tasks-subtasks','all')")
            )
            session.commit()
        except Exception:
            pass


def _migrate_task_position_column() -> None:
    """V1 additive migration: tasks.position + backfill in creation order.

    - Adds tasks.position when missing (older sqlite files).
    - Backfills NULL positions per parent scope ordered by id, so legacy
      Projects keep creation order. New rows get max+1 on create.
    Idempotent: safe to run on every boot and in tests.
    """
    from sqlalchemy import text

    with Session(engine) as session:
        try:
            cols = [r[1] for r in session.execute(text("PRAGMA table_info(tasks)")).all()]
        except Exception:
            return
        if not cols:
            return
        if "position" not in cols:
            try:
                session.execute(text("ALTER TABLE tasks ADD COLUMN position INTEGER"))
                session.commit()
            except Exception:
                return
    _migrate_task_positions()


def _migrate_task_positions() -> None:
    """Backfill NULL tasks.position per parent scope in id order.

    Scope = (project_id, parent_id) with NULL parent meaning top-level Tasks.
    Within each scope, rows with explicit positions keep them; NULL rows are
    appended after the current max in id order. All-NULL scopes therefore
    resolve to pure id order. Contiguous renumber is left to reorder calls.
    """
    from sqlalchemy import text

    with Session(engine) as session:
        try:
            rows = session.execute(text("SELECT id FROM tasks WHERE position IS NULL")).all()
            if not rows:
                return
            scopes = session.execute(
                text("SELECT DISTINCT project_id, parent_id FROM tasks WHERE position IS NULL")
            ).all()
        except Exception:
            return
        for project_id, parent_id in scopes:
            try:
                if parent_id is None:
                    siblings = session.execute(
                        text(
                            "SELECT id, position FROM tasks"
                            " WHERE project_id = :p AND parent_id IS NULL ORDER BY id"
                        ).bindparams(p=project_id)
                    ).all()
                else:
                    siblings = session.execute(
                        text(
                            "SELECT id, position FROM tasks"
                            " WHERE project_id = :p AND parent_id = :par ORDER BY id"
                        ).bindparams(p=project_id, par=parent_id)
                    ).all()
            except Exception:
                continue
            taken = sorted(r[1] for r in siblings if r[1] is not None)
            nxt = (max(taken) + 1) if taken else 1
            for tid, pos in siblings:
                if pos is not None:
                    continue
                try:
                    session.execute(
                        text("UPDATE tasks SET position = :n WHERE id = :t").bindparams(n=nxt, t=tid)
                    )
                    nxt += 1
                except Exception:
                    pass
        try:
            session.commit()
        except Exception:
            pass


def _migrate_task_history_note() -> None:
    """V1 additive migration: task_history.note for reorder audit rows."""
    from sqlalchemy import text

    with Session(engine) as session:
        try:
            cols = [r[1] for r in session.execute(text("PRAGMA table_info(task_history)")).all()]
        except Exception:
            return
        if not cols:
            return
        if "note" not in cols:
            try:
                session.execute(text("ALTER TABLE task_history ADD COLUMN note VARCHAR(512)"))
                session.commit()
            except Exception:
                pass


def _tint_hex(base: str, idx: int, total: int) -> str:
    try:
        h = base.lstrip("#")
        if len(h) == 3:
            h = "".join(c * 2 for c in h)
        r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    except Exception:
        return base
    total = max(total, 1)
    f = 0.0 if total <= 1 else (idx / (total - 1)) * 0.45
    r = round(r + (255 - r) * f)
    g = round(g + (255 - g) * f)
    b = round(b + (255 - b) * f)
    return f"#{r:02x}{g:02x}{b:02x}"


def _migrate_status_stages() -> None:
    """U3 additive migration: status_stages + statuses.stage_id/shade + 5+6+4 seed.

    - Adds statuses.stage_id / statuses.shade when missing (older sqlite files).
    - Migrates existing rows into one Stage ``Main`` per profile, preserving
      order; shade defaults to the stage base color when unset.
    - Seeds the Procurements 5+6+4 staged example (SPEC-v0.3 4.3) when missing.
    Idempotent: safe to run on every boot and in tests.
    """
    from sqlalchemy import text

    from sqlmodel import Session as _Session

    with _Session(engine) as session:
        try:
            scols = [r[1] for r in session.execute(text("PRAGMA table_info(statuses)")).all()]
        except Exception:
            return
        if not scols:
            return
        if "stage_id" not in scols:
            try:
                session.execute(text("ALTER TABLE statuses ADD COLUMN stage_id INTEGER"))
                session.commit()
            except Exception:
                pass
        if "shade" not in scols:
            try:
                session.execute(text("ALTER TABLE statuses ADD COLUMN shade VARCHAR(32)"))
                session.commit()
            except Exception:
                pass
        for col, ddl in [
            ("is_milestone", "ALTER TABLE statuses ADD COLUMN is_milestone BOOLEAN DEFAULT 0"),
            ("active", "ALTER TABLE statuses ADD COLUMN active BOOLEAN DEFAULT 1"),
            ("description", "ALTER TABLE statuses ADD COLUMN description VARCHAR(512) DEFAULT ''"),
        ]:
            if col not in scols:
                try:
                    session.execute(text(ddl))
                    session.commit()
                except Exception:
                    pass
        try:
            pcols = [r[1] for r in session.execute(text("PRAGMA table_info(status_profiles)")).all()]
        except Exception:
            pcols = []
        for col, ddl in [
            ("description", "ALTER TABLE status_profiles ADD COLUMN description VARCHAR(512) DEFAULT ''"),
            ("active", "ALTER TABLE status_profiles ADD COLUMN active BOOLEAN DEFAULT 1"),
        ]:
            if pcols and col not in pcols:
                try:
                    session.execute(text(ddl))
                    session.commit()
                except Exception:
                    pass
        # Ensure status_stages table exists for pre-U3 sqlite files.
        try:
            tcols = [r[1] for r in session.execute(text("PRAGMA table_info(status_stages)")).all()]
        except Exception:
            tcols = []
        if not tcols:
            try:
                session.execute(
                    text(
                        "CREATE TABLE IF NOT EXISTS status_stages ("
                        "id INTEGER PRIMARY KEY AUTOINCREMENT, "
                        "profile_id INTEGER NOT NULL REFERENCES status_profiles(id), "
                        "name VARCHAR(128) NOT NULL, "
                        "description VARCHAR(512) DEFAULT '', "
                        "\"order\" INTEGER NOT NULL DEFAULT 0, "
                        "active BOOLEAN DEFAULT 1, "
                        "color_base VARCHAR(32) NOT NULL DEFAULT '#6b7280')"
                    )
                )
                session.commit()
                session.execute(
                    text("CREATE INDEX IF NOT EXISTS ix_status_stages_profile_id ON status_stages (profile_id)")
                )
                session.commit()
            except Exception:
                pass
        elif tcols:
            for col, ddl in [
                ("description", "ALTER TABLE status_stages ADD COLUMN description VARCHAR(512) DEFAULT ''"),
                ("active", "ALTER TABLE status_stages ADD COLUMN active BOOLEAN DEFAULT 1"),
            ]:
                if col not in tcols:
                    try:
                        session.execute(text(ddl))
                        session.commit()
                    except Exception:
                        pass

    # ORM pass: backfill Main stages + seed Procurements example.
    with _Session(engine) as session:
        from app.statuses.models import Status, StatusProfile, StatusStage

        try:
            profiles = session.exec(select(StatusProfile)).all()
        except Exception:
            return
        for p in profiles:
            if p.id is None:
                continue
            try:
                stages = session.exec(
                    select(StatusStage).where(StatusStage.profile_id == p.id)
                ).all()
            except Exception:
                continue
            if not stages:
                main = StatusStage(
                    profile_id=p.id, name="Main", order=1, color_base="#6b7280"
                )
                session.add(main)
                session.commit()
                session.refresh(main)
                assert main.id is not None
                try:
                    rows = session.exec(
                        select(Status).where(Status.profile_id == p.id)
                    ).all()
                except Exception:
                    rows = []
                for s in rows:
                    s.stage_id = main.id
                    if not getattr(s, "shade", None):
                        s.shade = main.color_base
                    session.add(s)
                session.commit()

        # Seed Procurements 5+6+4 (three base hues, leaf shades auto-tinted).
        try:
            existing = session.exec(
                select(StatusProfile).where(StatusProfile.name == "Procurements")
            ).first()
        except Exception:
            existing = None
        if existing is None:
            seeded = StatusProfile(name="Procurements", is_template=True)
            session.add(seeded)
            session.commit()
            session.refresh(seeded)
            assert seeded.id is not None
            spec: list[tuple[str, str, list[str]]] = [
                (
                    "Prior Approval",
                    "#3b82f6",
                    [
                        "Concept approval to be requested",
                        "Pending concept approval",
                        "Concept approval ok\u2013proc approval to be requested",
                        "Pending proc approval",
                        "Procurement approval received",
                    ],
                ),
                (
                    "Procurement Stage",
                    "#f59e0b",
                    [
                        "Spec to be submitted",
                        "Spec submitted\u2013approval pending",
                        "Spec approved\u2013pending publishing",
                        "Published",
                        "Tender closed / Under evaluation",
                        "Approval received",
                    ],
                ),
                (
                    "Post Approval",
                    "#10b981",
                    [
                        "Award letter issued",
                        "PB received",
                        "Implementation",
                        "Completed",
                    ],
                ),
            ]
            order = 1
            for stage_order, (sname, base, leaves) in enumerate(spec, start=1):
                st = StatusStage(
                    profile_id=seeded.id,
                    name=sname,
                    order=stage_order,
                    color_base=base,
                )
                session.add(st)
                session.commit()
                session.refresh(st)
                assert st.id is not None
                for idx, leaf in enumerate(leaves):
                    session.add(
                        Status(
                            profile_id=seeded.id,
                            stage_id=st.id,
                            name=leaf,
                            color=base,
                            shade=_tint_hex(base, idx, len(leaves)),
                            order=order,
                            is_done=(leaf == "Completed"),
                        )
                    )
                    order += 1
            session.commit()
