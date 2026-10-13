import re

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlmodel import Session, select

from app.auth.models import User
from app.deps import get_current_user, get_session, require_writer
from app.projects.models import Project, ProjectLink, ProjectMember

router = APIRouter(prefix="/api/v1/projects", tags=["projects"])

CODE_RE = re.compile(r"^[A-Z0-9-]{2,12}$")
COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")

LINK_KINDS = ("relates-to", "continues-as")

PROJECT_STATUSES = ("Not Started", "Active", "Complete")


def _validate_color(color: str | None) -> str:
    color = (color or "#6b7280").strip()
    if not COLOR_RE.match(color):
        raise HTTPException(status_code=422, detail="Invalid color (hex #rrggbb)")
    return color.lower()


def _normalize_project_status(value: str | None) -> str | None:
    if value is None:
        return None
    v = value.strip()
    for allowed in PROJECT_STATUSES:
        if v.lower() == allowed.lower():
            return allowed
    raise HTTPException(status_code=422, detail="Invalid project_status (Not Started|Active|Complete)")


class ProjectCreate(BaseModel):
    name: str
    code: str | None = None
    category_id: int | None = None
    description: str = ""
    color: str = "#6b7280"
    start_date: str | None = None
    target_date: str | None = None
    status_profile_id: int | None = None
    project_status: str | None = None


class ProjectOut(BaseModel):
    id: int
    name: str
    code: str
    category_id: int | None = None
    category_name: str | None = None
    description: str
    color: str = "#6b7280"
    start_date: str | None = None
    target_date: str | None = None
    task_count: int = 0
    owner_id: int | None = None
    owner_name: str | None = None
    status_profile_id: int | None = None
    project_status: str = "Active"
    tree_default: str = "all"


class ProjectUpdate(BaseModel):
    name: str | None = None
    code: str | None = None
    description: str | None = None
    color: str | None = None
    start_date: str | None = None
    target_date: str | None = None
    project_status: str | None = None


class MemberAdd(BaseModel):
    user_id: int
    role: str = "member"


class MemberOut(BaseModel):
    project_id: int
    user_id: int
    role: str


class LinkCreate(BaseModel):
    to_project_id: int
    kind: str = "relates-to"
    note: str = ""


class LinkOut(BaseModel):
    id: int
    from_project_id: int
    to_project_id: int
    kind: str
    note: str
    created_by: int | None = None
    created_at: str
    from_project_name: str | None = None
    from_project_code: str | None = None
    from_category_id: int | None = None
    from_category_name: str | None = None
    to_project_name: str | None = None
    to_project_code: str | None = None
    to_category_id: int | None = None
    to_category_name: str | None = None


def _link_out(link: ProjectLink, session: Session) -> LinkOut:
    assert link.id is not None
    from_name: str | None = None
    from_code: str | None = None
    from_cat_id: int | None = None
    from_cat_name: str | None = None
    to_name: str | None = None
    to_code: str | None = None
    to_cat_id: int | None = None
    to_cat_name: str | None = None
    try:
        from app.categories.models import Category

        if link.from_project_id is not None:
            fp = session.get(Project, link.from_project_id)
            if fp is not None:
                from_name = fp.name
                from_code = fp.code
                from_cat_id = getattr(fp, "category_id", None)
                if from_cat_id is not None:
                    cat = session.get(Category, from_cat_id)
                    from_cat_name = cat.name if cat else None
        if link.to_project_id is not None:
            tp = session.get(Project, link.to_project_id)
            if tp is not None:
                to_name = tp.name
                to_code = tp.code
                to_cat_id = getattr(tp, "category_id", None)
                if to_cat_id is not None:
                    cat = session.get(Category, to_cat_id)
                    to_cat_name = cat.name if cat else None
    except Exception:
        pass
    return LinkOut(
        id=link.id,
        from_project_id=link.from_project_id or 0,
        to_project_id=link.to_project_id or 0,
        kind=link.kind,
        note=link.note,
        created_by=link.created_by,
        created_at=link.created_at,
        from_project_name=from_name,
        from_project_code=from_code,
        from_category_id=from_cat_id,
        from_category_name=from_cat_name,
        to_project_name=to_name,
        to_project_code=to_code,
        to_category_id=to_cat_id,
        to_category_name=to_cat_name,
    )


def _out(p: Project, session: Session) -> ProjectOut:
    assert p.id is not None
    owner = session.get(User, p.owner_id) if p.owner_id else None
    owner_name = owner.name if owner else (owner.username if owner else None)
    category_name: str | None = None
    cat_id = getattr(p, "category_id", None)
    if cat_id is not None:
        try:
            from app.categories.models import Category

            cat = session.get(Category, cat_id)
            category_name = cat.name if cat else None
        except Exception:
            category_name = None
    task_count = 0
    try:
        from app.tasks.models import Task
        from sqlalchemy import func
        task_count = session.exec(select(func.count(Task.id)).where(Task.project_id == p.id)).one()  # type: ignore[arg-type]
    except Exception:
        pass
    return ProjectOut(
        id=p.id,
        name=p.name,
        code=p.code,
        category_id=cat_id,
        category_name=category_name,
        description=p.description,
        color=getattr(p, "color", None) or "#6b7280",
        start_date=p.start_date,
        target_date=p.target_date,
        task_count=task_count,
        owner_id=p.owner_id,
        owner_name=owner_name,
        status_profile_id=p.status_profile_id,
        project_status=getattr(p, "project_status", None) or "Active",
        tree_default=getattr(p, "tree_default", None) or "all",
    )


def is_member(session: Session, project_id: int, user_id: int) -> ProjectMember | None:
    return session.get(ProjectMember, (project_id, user_id))


def require_project_access(project_id: int, current: User, session: Session) -> Project:
    """Hybrid membership gate (SPEC-v0.3 section 3, U1).

    Effective visibility = union (category ∪ project). Non-members get 404
    (not 403) to avoid enumeration. Admin bypasses so a fresh admin can
    bootstrap Projects; all other roles require a row in project_members
    or category_members for the parent Category (once U2 adds category_id).
    """
    project = session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Not found")
    assert current.id is not None
    if current.role == "admin":
        return project
    if is_member(session, project_id, current.id) is not None:
        return project
    from app.categories.access import effective_role_for_project

    if effective_role_for_project(session, project, current.id) is not None:
        return project
    raise HTTPException(status_code=404, detail="Not found")


@router.get("", response_model=list[ProjectOut])
def list_projects(
    category_id: int | None = None,
    project_status: str | None = None,
    current: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    assert current.id is not None
    status_filter = _normalize_project_status(project_status) if project_status else None
    if current.role == "admin":
        q = select(Project).order_by(Project.code)  # type: ignore[arg-type]
        if category_id is not None:
            q = q.where(Project.category_id == category_id)
        if status_filter is not None:
            q = q.where(Project.project_status == status_filter)
        rows = session.exec(q).all()
        return [_out(p, session) for p in rows]
    from app.categories.access import visible_project_ids

    ids = visible_project_ids(session, current.id)
    if not ids:
        return []
    q = select(Project).where(Project.id.in_(ids)).order_by(Project.code)  # type: ignore[arg-type,union-attr]
    if category_id is not None:
        q = q.where(Project.category_id == category_id)
    if status_filter is not None:
        q = q.where(Project.project_status == status_filter)
    rows = session.exec(q).all()
    return [_out(p, session) for p in rows]


@router.post("", response_model=ProjectOut, status_code=status.HTTP_201_CREATED)
def create_project(
    body: ProjectCreate,
    current: User = Depends(require_writer),
    session: Session = Depends(get_session),
):
    from app.categories.models import Category, CategoryMember

    assert current.id is not None
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(status_code=422, detail="Name required")

    # Resolve parent Category. Backwards-compat: pre-U2 callers without
    # category_id get an auto-provisioned Category (CAT-<CODE>) so old
    # data flows keep working; new UI always sends category_id.
    category_id = body.category_id
    if category_id is None:
        base_code = (body.code or "").strip().upper()
        if not base_code or not CODE_RE.match(base_code):
            base = "".join(c for c in name.upper() if c.isalnum())[:6] or "PRJ"
            base_code = f"{base}-{abs(hash(name)) % 900 + 100}"
            if not CODE_RE.match(base_code):
                base_code = f"PRJ-{abs(hash(name)) % 9000 + 1000}"
        key_candidate = f"CAT-{base_code}"[:16]
        key = key_candidate
        suffix = 2
        while session.exec(select(Category).where(Category.key == key)).first():
            tail = f"-{suffix}"
            key = (key_candidate[: 16 - len(tail)] + tail) if len(key_candidate + tail) > 16 else (key_candidate + tail)
            suffix += 1
        cat_name = name
        n = 2
        probe = cat_name
        while session.exec(select(Category).where(Category.name == probe)).first():
            probe = f"{name} {base_code}" if n == 2 else f"{name} {base_code} {n}"
            n += 1
        cat_name = probe
        new_category = Category(key=key, name=cat_name, color="#6b7280", created_by=current.id)
        session.add(new_category)
        session.commit()
        session.refresh(new_category)
        assert new_category.id is not None
        category_id = new_category.id
        session.add(CategoryMember(category_id=new_category.id, user_id=current.id, role=current.role))
        session.commit()
    else:
        existing = session.get(Category, category_id)
        if existing is None:
            raise HTTPException(status_code=404, detail="Not found")
        # SPEC-v0.3 section 3: membership in parent Category, or global
        # admin/manager. Non-members get 404 (no enumeration).
        if current.role not in ("admin", "manager"):
            if session.get(CategoryMember, (category_id, current.id)) is None:
                raise HTTPException(status_code=404, detail="Not found")

    assert category_id is not None
    if not body.code:
        base = "".join(c for c in name.upper() if c.isalnum())[:6] or "PRJ"
        code = f"{base}-{abs(hash(name)) % 900 + 100}"
        if not CODE_RE.match(code):
            code = f"PRJ-{abs(hash(name)) % 9000 + 1000}"
        body.code = code
    assert body.code is not None
    if not CODE_RE.match(body.code):
        raise HTTPException(status_code=400, detail="Invalid code (A-Z0-9-, 2-12 chars)")
    # Scoped uniques: UNIQUE(category_id, code) + UNIQUE(category_id, name).
    # Duplicate within one Category is 422 per ticket acceptance; same
    # code/name across Categories is fine.
    if session.exec(
        select(Project).where(Project.category_id == category_id, Project.code == body.code)
    ).first():
        raise HTTPException(status_code=422, detail="Code exists in this Category")
    if session.exec(
        select(Project).where(Project.category_id == category_id, Project.name == name)
    ).first():
        raise HTTPException(status_code=422, detail="Name exists in this Category")
    project = Project(
        category_id=category_id,
        name=name,
        code=body.code,
        description=body.description,
        color=_validate_color(body.color),
        owner_id=current.id,
        start_date=body.start_date,
        target_date=body.target_date,
        status_profile_id=body.status_profile_id,
        project_status=_normalize_project_status(body.project_status) or "Active",
    )
    session.add(project)
    try:
        session.commit()
    except Exception as exc:
        session.rollback()
        msg = str(exc).lower()
        if "unique" in msg or "uq_projects_category" in msg:
            raise HTTPException(status_code=422, detail="Code or name exists in this Category")
        raise
    session.refresh(project)
    assert project.id is not None
    # auto-membership for creator (unless admin bypass already covers it)
    if session.get(ProjectMember, (project.id, current.id)) is None:
        session.add(ProjectMember(project_id=project.id, user_id=current.id, role=current.role))
    # Ensure category membership so the union gate keeps working.
    if session.get(CategoryMember, (category_id, current.id)) is None:
        try:
            session.add(CategoryMember(category_id=category_id, user_id=current.id, role=current.role))
        except Exception:
            pass
    session.commit()
    return _out(project, session)


@router.get("/{project_id}", response_model=ProjectOut)
def get_project(project_id: int, current: User = Depends(get_current_user), session: Session = Depends(get_session)):
    return _out(require_project_access(project_id, current, session), session)


@router.patch("/{project_id}", response_model=ProjectOut)
def update_project(
    project_id: int,
    body: ProjectUpdate,
    current: User = Depends(require_writer),
    session: Session = Depends(get_session),
):
    """Project Settings: name, code, dates, project_status (label only, free transitions)."""
    project = require_project_access(project_id, current, session)
    if current.role not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Manager or admin only")
    assert project.id is not None and project.category_id is not None
    if body.name is not None:
        name = body.name.strip()
        if not name:
            raise HTTPException(status_code=422, detail="Name required")
        existing = session.exec(
            select(Project).where(Project.category_id == project.category_id, Project.name == name)
        ).first()
        if existing is not None and existing.id != project.id:
            raise HTTPException(status_code=422, detail="Name exists in this Category")
        project.name = name
    if body.code is not None:
        code = body.code.strip().upper()
        if not CODE_RE.match(code):
            raise HTTPException(status_code=400, detail="Invalid code (A-Z0-9-, 2-12 chars)")
        existing = session.exec(
            select(Project).where(Project.category_id == project.category_id, Project.code == code)
        ).first()
        if existing is not None and existing.id != project.id:
            raise HTTPException(status_code=422, detail="Code exists in this Category")
        project.code = code
    if body.description is not None:
        project.description = body.description[:2000]
    if body.color is not None:
        project.color = _validate_color(body.color)
    if "start_date" in body.model_fields_set:
        project.start_date = body.start_date
    if "target_date" in body.model_fields_set:
        project.target_date = body.target_date
    if body.project_status is not None:
        project.project_status = _normalize_project_status(body.project_status) or "Active"
    session.add(project)
    try:
        session.commit()
    except Exception as exc:
        session.rollback()
        msg = str(exc).lower()
        if "unique" in msg or "uq_projects_category" in msg:
            raise HTTPException(status_code=422, detail="Code or name exists in this Category")
        raise
    session.refresh(project)
    return _out(project, session)


@router.get("/{project_id}/members", response_model=list[MemberOut])
def list_members(project_id: int, current: User = Depends(get_current_user), session: Session = Depends(get_session)):
    require_project_access(project_id, current, session)
    rows = session.exec(select(ProjectMember).where(ProjectMember.project_id == project_id)).all()
    assert all(r.project_id is not None and r.user_id is not None for r in rows)
    return [MemberOut(project_id=r.project_id or 0, user_id=r.user_id or 0, role=r.role) for r in rows]


@router.delete("/{project_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_member(
    project_id: int,
    user_id: int,
    current: User = Depends(require_writer),
    session: Session = Depends(get_session),
):
    """Settings member removal (T8): admin always; manager on own Projects."""
    require_project_access(project_id, current, session)
    if current.role not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Settings requires manager+")
    row = session.get(ProjectMember, (project_id, user_id))
    if row is None:
        raise HTTPException(status_code=404, detail="Member not found")
    session.delete(row)
    session.commit()
    return None


class ProjectFieldDefOut(BaseModel):
    id: int
    profile_id: int | None = None
    project_id: int | None = None
    key: str
    type: str
    label: str
    required: bool
    order: int


@router.get("/{project_id}/custom-field-defs", response_model=list[ProjectFieldDefOut])
def list_project_field_defs(
    project_id: int,
    current: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """Custom-field columns for the Table view (T8): defs copied on apply-profile."""
    project = require_project_access(project_id, current, session)
    from app.statuses.models import CustomFieldDef

    rows = session.exec(
        select(CustomFieldDef).where(
            (CustomFieldDef.profile_id == project.status_profile_id)
            | (CustomFieldDef.project_id == project.id)
        ).order_by(CustomFieldDef.order)  # type: ignore[arg-type]
    ).all()
    return [
        ProjectFieldDefOut(
            id=r.id,  # type: ignore[arg-type]
            profile_id=r.profile_id,
            project_id=r.project_id,
            key=r.key,
            type=r.type,
            label=r.label,
            required=r.required,
            order=r.order,
        )
        for r in rows
    ]


@router.post("/{project_id}/members", response_model=MemberOut, status_code=status.HTTP_201_CREATED)
def add_member(
    project_id: int,
    body: MemberAdd,
    current: User = Depends(require_writer),
    session: Session = Depends(get_session),
):
    project = require_project_access(project_id, current, session)
    assert project.id is not None
    # Settings rule: admin always; manager only on own (member) Projects
    if current.role not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Settings requires manager+")
    if session.get(User, body.user_id) is None:
        raise HTTPException(status_code=404, detail="User not found")
    existing = session.get(ProjectMember, (project.id, body.user_id))
    if existing:
        existing.role = body.role
        session.add(existing)
        session.commit()
        assert existing.project_id is not None and existing.user_id is not None
        return MemberOut(project_id=existing.project_id, user_id=existing.user_id, role=existing.role)
    row = ProjectMember(project_id=project.id, user_id=body.user_id, role=body.role)
    session.add(row)
    session.commit()
    assert row.project_id is not None and row.user_id is not None
    return MemberOut(project_id=row.project_id, user_id=row.user_id, role=row.role)


@router.post("/{project_id}/apply-profile/{profile_id}", response_model=ProjectOut)
def apply_profile(
    project_id: int,
    profile_id: int,
    current: User = Depends(require_writer),
    session: Session = Depends(get_session),
):
    project = require_project_access(project_id, current, session)
    if current.role not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Manager or admin only")

    from app.statuses.models import StatusProfile, Status, CustomFieldDef, StatusStage

    template = session.get(StatusProfile, profile_id)
    if not template:
        raise HTTPException(status_code=404, detail="Template status profile not found")

    assert current.id is not None
    proj_profile = StatusProfile(
        name=f"{project.name} Profile",
        is_template=False,
        created_by=current.id,
    )
    session.add(proj_profile)
    session.commit()
    session.refresh(proj_profile)
    assert proj_profile.id is not None

    # U3: copy stages first so per-Project copies keep stage grouping.
    stage_map: dict[int, int] = {}
    for st in session.exec(select(StatusStage).where(StatusStage.profile_id == template.id)).all():
        assert st.id is not None
        new_st = StatusStage(
            profile_id=proj_profile.id,
            name=st.name,
            order=st.order,
            color_base=st.color_base,
        )
        session.add(new_st)
        session.commit()
        session.refresh(new_st)
        assert new_st.id is not None
        stage_map[st.id] = new_st.id

    for s in session.exec(select(Status).where(Status.profile_id == template.id)).all():
        new_s = Status(
            profile_id=proj_profile.id,
            stage_id=stage_map.get(s.stage_id) if s.stage_id is not None else None,
            name=s.name,
            color=s.color,
            shade=s.shade,
            order=s.order,
            is_done=s.is_done,
            is_blocked=s.is_blocked,
            kind=getattr(s, "kind", None) or "normal",
        )
        session.add(new_s)

    for c in session.exec(select(CustomFieldDef).where(CustomFieldDef.profile_id == template.id)).all():
        new_c = CustomFieldDef(
            profile_id=proj_profile.id,
            project_id=project.id,
            key=c.key,
            type=c.type,
            label=c.label,
            required=c.required,
            order=c.order,
        )
        session.add(new_c)

    project.status_profile_id = proj_profile.id
    session.add(project)
    session.commit()
    session.refresh(project)
    return _out(project, session)


@router.get("/{project_id}/links", response_model=list[LinkOut])
def list_links(
    project_id: int,
    current: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """Outgoing plain links for the Project header chips (U6, ADR-0006)."""
    require_project_access(project_id, current, session)
    rows = session.exec(
        select(ProjectLink).where(ProjectLink.from_project_id == project_id).order_by(ProjectLink.id)  # type: ignore[arg-type]
    ).all()
    return [_link_out(r, session) for r in rows]


@router.post("/{project_id}/links", response_model=LinkOut, status_code=status.HTTP_201_CREATED)
def create_link(
    project_id: int,
    body: LinkCreate,
    current: User = Depends(require_writer),
    session: Session = Depends(get_session),
):
    """Create a plain cross-Category ref (no rollup, no cross-Project blocking)."""
    require_project_access(project_id, current, session)
    kind = (body.kind or "").strip()
    if kind not in LINK_KINDS:
        raise HTTPException(status_code=422, detail="Invalid kind (relates-to|continues-as)")
    if body.to_project_id == project_id:
        raise HTTPException(status_code=422, detail="Self-link not allowed")
    # Target must exist and be visible to the caller (404 avoids enumeration).
    require_project_access(body.to_project_id, current, session)
    if session.exec(
        select(ProjectLink).where(
            ProjectLink.from_project_id == project_id,
            ProjectLink.to_project_id == body.to_project_id,
            ProjectLink.kind == kind,
        )
    ).first():
        raise HTTPException(status_code=422, detail="Link already exists for this pair+kind")
    assert current.id is not None
    link = ProjectLink(
        from_project_id=project_id,
        to_project_id=body.to_project_id,
        kind=kind,
        note=(body.note or "")[:2000],
        created_by=current.id,
    )
    session.add(link)
    try:
        session.commit()
    except Exception as exc:
        session.rollback()
        msg = str(exc).lower()
        if "unique" in msg or "uq_project_links_pair_kind" in msg:
            raise HTTPException(status_code=422, detail="Link already exists for this pair+kind")
        raise
    session.refresh(link)
    return _link_out(link, session)


@router.delete("/{project_id}/links/{link_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_link(
    project_id: int,
    link_id: int,
    current: User = Depends(require_writer),
    session: Session = Depends(get_session),
):
    require_project_access(project_id, current, session)
    link = session.get(ProjectLink, link_id)
    if link is None or link.from_project_id != project_id:
        raise HTTPException(status_code=404, detail="Not found")
    session.delete(link)
    session.commit()
    return None


class TreeDefaultUpdate(BaseModel):
    tree_default: str


@router.get("/{project_id}/tree-default")
def get_project_tree_default(
    project_id: int,
    current: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    project = require_project_access(project_id, current, session)
    return {"tree_default": getattr(project, "tree_default", None) or "all"}


@router.patch("/{project_id}/tree-default")
def update_project_tree_default(
    project_id: int,
    body: TreeDefaultUpdate,
    current: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    project = require_project_access(project_id, current, session)
    if current.role != "admin" and project.owner_id != current.id:
        raise HTTPException(status_code=403, detail="Owner only")
    val = (body.tree_default or "").strip().lower()
    if val not in ("tasks-only", "tasks-subtasks", "all"):
        raise HTTPException(status_code=422, detail="Invalid tree_default (tasks-only|tasks-subtasks|all)")
    project.tree_default = val
    session.add(project)
    session.commit()
    session.refresh(project)
    return {"tree_default": project.tree_default}


@router.delete("/{project_id}")
def delete_project(
    project_id: int,
    current: User = Depends(require_writer),
    session: Session = Depends(get_session),
):
    """Delete a Project; anchored Reminders detach to standalone (03).

    Delete is never blocked by Reminders and never cascade-deletes them:
    project-anchored + task-anchored nudges keep their ex-anchor title and
    stay actionable. Tasks cascade like the task delete seam (related rows
    removed); Project links/members for the project are removed.
    """
    project = require_project_access(project_id, current, session)
    if current.role not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Manager or admin only")
    assert project.id is not None
    pid = project.id
    pname = project.name

    from app.tasks.models import (
        Task,
        TaskAssignee,
        TaskAttachment,
        TaskBlockedBy,
        TaskComment,
        TaskCommentMention,
        TaskHistory,
        TaskStatusPeriod,
        TaskTag,
        TaskWatcher,
    )

    task_rows = session.exec(select(Task).where(Task.project_id == pid)).all()
    task_titles = {t.id: t.title for t in task_rows if t.id is not None}
    task_ids = [t.id for t in task_rows if t.id is not None]

    from app.reminders.service import detach_for_project as _detach_proj

    try:
        detached = _detach_proj(session, pid, pname, task_titles)
        session.commit()
    except Exception:
        # Detach must never block delete: fall through to row deletion
        # (Reminders are never cascade-deleted below).
        try:
            session.rollback()
        except Exception:
            pass
        detached = []

    import os as _os

    from app.statuses.models import CustomFieldValue

    for tid in task_ids:
        for a in session.exec(select(TaskAssignee).where(TaskAssignee.task_id == tid)).all():
            session.delete(a)
        for w in session.exec(select(TaskWatcher).where(TaskWatcher.task_id == tid)).all():
            session.delete(w)
        for tt in session.exec(select(TaskTag).where(TaskTag.task_id == tid)).all():
            session.delete(tt)
        for b in session.exec(select(TaskBlockedBy).where(TaskBlockedBy.task_id == tid)).all():
            session.delete(b)
        for p in session.exec(select(TaskStatusPeriod).where(TaskStatusPeriod.task_id == tid)).all():
            session.delete(p)
        for hrow in session.exec(select(TaskHistory).where(TaskHistory.task_id == tid)).all():
            session.delete(hrow)
        for v in session.exec(select(CustomFieldValue).where(CustomFieldValue.task_id == tid)).all():
            session.delete(v)
        for c in session.exec(select(TaskComment).where(TaskComment.task_id == tid)).all():
            assert c.id is not None
            for m in session.exec(
                select(TaskCommentMention).where(TaskCommentMention.comment_id == c.id)
            ).all():
                session.delete(m)
            session.delete(c)
        for att in session.exec(select(TaskAttachment).where(TaskAttachment.task_id == tid)).all():
            fpath = att.path
            session.delete(att)
            try:
                if fpath and _os.path.isfile(fpath):
                    _os.remove(fpath)
            except OSError:
                pass
    for t in task_rows:
        session.delete(t)
    for link in session.exec(
        select(ProjectLink).where(
            (ProjectLink.from_project_id == pid) | (ProjectLink.to_project_id == pid)
        )
    ).all():
        session.delete(link)
    for pm in session.exec(select(ProjectMember).where(ProjectMember.project_id == pid)).all():
        session.delete(pm)
    session.delete(project)
    session.commit()
    return {"deleted_project_id": pid, "detached_reminder_ids": detached}
