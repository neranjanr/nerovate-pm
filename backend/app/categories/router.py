import re

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlmodel import Session, select

from app.auth.models import User
from app.categories.access import is_category_member
from app.categories.models import Category, CategoryMember
from app.deps import get_current_user, get_session, require_writer

router = APIRouter(prefix="/api/v1/categories", tags=["categories"])

KEY_RE = re.compile(r"^CAT-[A-Z0-9-]{2,12}$")


def _make_key(name: str) -> str:
    base = re.sub(r"[^A-Z0-9]", "", name.upper())[:8] or "CAT"
    return f"CAT-{base}"


def _unique_key(session: Session, candidate: str) -> str:
    key = candidate
    suffix = 2
    while session.exec(select(Category).where(Category.key == key)).first():
        tail = f"-{suffix}"
        key = candidate[: 16 - len(tail)] + tail if len(candidate + tail) > 16 else candidate + tail
        suffix += 1
    return key


class CategoryCreate(BaseModel):
    name: str
    key: str | None = None
    color: str = "#6b7280"
    status_profile_id: int | None = None


class CategoryUpdate(BaseModel):
    name: str | None = None
    color: str | None = None
    status_profile_id: int | None = None


class CategoryOut(BaseModel):
    id: int
    key: str
    name: str
    color: str
    status_profile_id: int | None = None
    project_count: int = 0
    profile_name: str | None = None


class MemberAdd(BaseModel):
    user_id: int
    role: str = "member"


class MemberOut(BaseModel):
    category_id: int
    user_id: int
    role: str


def _project_count(session: Session, category_id: int) -> int:
    from app.projects.models import Project

    if "category_id" not in Project.model_fields:
        return 0
    try:
        from sqlalchemy import func

        n = session.exec(
            select(func.count()).select_from(Project).where(Project.category_id == category_id)  # type: ignore[attr-defined]
        ).one()
        return int(n)
    except Exception:
        return 0


def _out(c: Category, session: Session) -> CategoryOut:
    assert c.id is not None
    profile_name: str | None = None
    if c.status_profile_id is not None:
        from app.statuses.models import StatusProfile

        prof = session.get(StatusProfile, c.status_profile_id)
        profile_name = prof.name if prof else None
    return CategoryOut(
        id=c.id,
        key=c.key,
        name=c.name,
        color=c.color,
        status_profile_id=c.status_profile_id,
        project_count=_project_count(session, c.id),
        profile_name=profile_name,
    )


def require_category_access(category_id: int, current: User, session: Session) -> Category:
    """Membership gate: non-members get 404 (not 403) to avoid enumeration."""
    category = session.get(Category, category_id)
    if category is None:
        raise HTTPException(status_code=404, detail="Not found")
    assert current.id is not None
    if current.role == "admin":
        return category
    if is_category_member(session, category_id, current.id) is None:
        raise HTTPException(status_code=404, detail="Not found")
    return category


@router.get("", response_model=list[CategoryOut])
def list_categories(current: User = Depends(get_current_user), session: Session = Depends(get_session)):
    assert current.id is not None
    if current.role == "admin":
        rows = session.exec(select(Category).order_by(Category.id)).all()  # type: ignore[arg-type]
        return [_out(c, session) for c in rows]
    mrows = session.exec(select(CategoryMember).where(CategoryMember.user_id == current.id)).all()
    ids = [m.category_id for m in mrows if m.category_id is not None]
    if not ids:
        return []
    rows = session.exec(select(Category).where(Category.id.in_(ids)).order_by(Category.id)).all()  # type: ignore[arg-type,union-attr]
    return [_out(c, session) for c in rows]


@router.post("", response_model=CategoryOut, status_code=status.HTTP_201_CREATED)
def create_category(
    body: CategoryCreate,
    current: User = Depends(require_writer),
    session: Session = Depends(get_session),
):
    if current.role not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Manager or admin only")
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name required")
    if session.exec(select(Category).where(Category.name == name)).first():
        raise HTTPException(status_code=409, detail="Name exists")
    if body.key is not None:
        key = body.key.strip().upper()
        if not KEY_RE.match(key):
            raise HTTPException(status_code=400, detail="Invalid key (CAT-A-Z0-9-, 6-16 chars)")
        if session.exec(select(Category).where(Category.key == key)).first():
            raise HTTPException(status_code=409, detail="Key exists")
    else:
        key = _unique_key(session, _make_key(name))
        if not KEY_RE.match(key):
            key = _unique_key(session, "CAT-PRJ")
    if body.status_profile_id is not None:
        from app.statuses.models import StatusProfile

        if session.get(StatusProfile, body.status_profile_id) is None:
            raise HTTPException(status_code=404, detail="Status profile not found")
    assert current.id is not None
    category = Category(
        key=key,
        name=name,
        color=body.color or "#6b7280",
        status_profile_id=body.status_profile_id,
        created_by=current.id,
    )
    session.add(category)
    session.commit()
    session.refresh(category)
    assert category.id is not None
    session.add(CategoryMember(category_id=category.id, user_id=current.id, role=current.role))
    session.commit()
    return _out(category, session)


@router.get("/{category_id}", response_model=CategoryOut)
def get_category(category_id: int, current: User = Depends(get_current_user), session: Session = Depends(get_session)):
    return _out(require_category_access(category_id, current, session), session)


@router.patch("/{category_id}", response_model=CategoryOut)
def update_category(
    category_id: int,
    body: CategoryUpdate,
    current: User = Depends(require_writer),
    session: Session = Depends(get_session),
):
    category = require_category_access(category_id, current, session)
    if current.role not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Manager or admin only")
    # Rename changes name only, never key: key is immutable (extra key fields ignored by schema).
    if body.name is not None:
        name = body.name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="Name required")
        existing = session.exec(select(Category).where(Category.name == name)).first()
        if existing is not None and existing.id != category.id:
            raise HTTPException(status_code=409, detail="Name exists")
        category.name = name
    if body.color is not None:
        category.color = body.color
    if "status_profile_id" in body.model_fields_set:
        if body.status_profile_id is not None:
            from app.statuses.models import StatusProfile

            if session.get(StatusProfile, body.status_profile_id) is None:
                raise HTTPException(status_code=404, detail="Status profile not found")
        category.status_profile_id = body.status_profile_id
    session.add(category)
    session.commit()
    session.refresh(category)
    return _out(category, session)


@router.delete("/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_category(
    category_id: int,
    current: User = Depends(require_writer),
    session: Session = Depends(get_session),
):
    category = require_category_access(category_id, current, session)
    if current.role not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Manager or admin only")
    assert category.id is not None
    # U2 cascade: once projects carry category_id, deleting a Category removes
    # its Projects (same rule as Project -> Tasks). Pre-U2 this is a no-op.
    from app.projects.models import Project, ProjectMember

    if "category_id" in Project.model_fields:
        prows = session.exec(select(Project).where(Project.category_id == category.id)).all()  # type: ignore[attr-defined]
        for p in prows:
            assert p.id is not None
            for pm in session.exec(select(ProjectMember).where(ProjectMember.project_id == p.id)).all():
                session.delete(pm)
            session.delete(p)
    for cm in session.exec(select(CategoryMember).where(CategoryMember.category_id == category.id)).all():
        session.delete(cm)
    session.delete(category)
    session.commit()
    return None


@router.get("/{category_id}/members", response_model=list[MemberOut])
def list_category_members(
    category_id: int, current: User = Depends(get_current_user), session: Session = Depends(get_session)
):
    require_category_access(category_id, current, session)
    rows = session.exec(select(CategoryMember).where(CategoryMember.category_id == category_id)).all()
    assert all(r.category_id is not None and r.user_id is not None for r in rows)
    return [MemberOut(category_id=r.category_id or 0, user_id=r.user_id or 0, role=r.role) for r in rows]


@router.post("/{category_id}/members", response_model=MemberOut, status_code=status.HTTP_201_CREATED)
def add_category_member(
    category_id: int,
    body: MemberAdd,
    current: User = Depends(require_writer),
    session: Session = Depends(get_session),
):
    require_category_access(category_id, current, session)
    if current.role not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Manager or admin only")
    if session.get(User, body.user_id) is None:
        raise HTTPException(status_code=404, detail="User not found")
    existing = session.get(CategoryMember, (category_id, body.user_id))
    if existing:
        existing.role = body.role
        session.add(existing)
        session.commit()
        assert existing.category_id is not None and existing.user_id is not None
        return MemberOut(category_id=existing.category_id, user_id=existing.user_id, role=existing.role)
    row = CategoryMember(category_id=category_id, user_id=body.user_id, role=body.role)
    session.add(row)
    session.commit()
    assert row.category_id is not None and row.user_id is not None
    return MemberOut(category_id=row.category_id, user_id=row.user_id, role=row.role)


@router.delete("/{category_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_category_member(
    category_id: int,
    user_id: int,
    current: User = Depends(require_writer),
    session: Session = Depends(get_session),
):
    require_category_access(category_id, current, session)
    if current.role not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Manager or admin only")
    row = session.get(CategoryMember, (category_id, user_id))
    if row is None:
        raise HTTPException(status_code=404, detail="Member not found")
    session.delete(row)
    session.commit()
    return None


@router.get("/{category_id}/projects")
def list_category_projects(
    category_id: int, current: User = Depends(get_current_user), session: Session = Depends(get_session)
):
    require_category_access(category_id, current, session)
    from app.projects.models import Project
    from app.projects.router import _out as _project_out

    if "category_id" not in Project.model_fields:
        return []
    rows = session.exec(select(Project).where(Project.category_id == category_id).order_by(Project.id)).all()  # type: ignore[attr-defined,arg-type]
    return [_project_out(p, session) for p in rows]
