import re

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlmodel import Session, select

from app.auth.models import User
from app.deps import get_current_user, get_session, require_writer
from app.projects.models import Project, ProjectMember

router = APIRouter(prefix="/api/v1/projects", tags=["projects"])

CODE_RE = re.compile(r"^[A-Z0-9-]{2,12}$")


class ProjectCreate(BaseModel):
    name: str
    code: str | None = None
    description: str = ""
    start_date: str | None = None
    target_date: str | None = None
    status_profile_id: int | None = None


class ProjectOut(BaseModel):
    id: int
    name: str
    code: str
    description: str
    start_date: str | None = None
    target_date: str | None = None
    task_count: int = 0
    owner_id: int | None = None
    owner_name: str | None = None
    status_profile_id: int | None = None


class MemberAdd(BaseModel):
    user_id: int
    role: str = "member"


class MemberOut(BaseModel):
    project_id: int
    user_id: int
    role: str


def _out(p: Project, session: Session) -> ProjectOut:
    assert p.id is not None
    owner = session.get(User, p.owner_id) if p.owner_id else None
    owner_name = owner.name if owner else (owner.username if owner else None)
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
        description=p.description,
        start_date=p.start_date,
        target_date=p.target_date,
        task_count=task_count,
        owner_id=p.owner_id,
        owner_name=owner_name,
        status_profile_id=p.status_profile_id,
    )


def is_member(session: Session, project_id: int, user_id: int) -> ProjectMember | None:
    return session.get(ProjectMember, (project_id, user_id))


def require_project_access(project_id: int, current: User, session: Session) -> Project:
    """Membership gate: non-members get 404 (not 403) to avoid enumeration.

    Admin bypasses so a fresh admin can bootstrap Projects; all other
    roles require a row in project_members.
    """
    project = session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Not found")
    assert current.id is not None
    if current.role == "admin":
        return project
    if is_member(session, project_id, current.id) is None:
        raise HTTPException(status_code=404, detail="Not found")
    return project


@router.get("", response_model=list[ProjectOut])
def list_projects(current: User = Depends(get_current_user), session: Session = Depends(get_session)):
    assert current.id is not None
    if current.role == "admin":
        rows = session.exec(select(Project).order_by(Project.id)).all()  # type: ignore[arg-type]
        return [_out(p, session) for p in rows]
    mrows = session.exec(select(ProjectMember).where(ProjectMember.user_id == current.id)).all()
    ids = [m.project_id for m in mrows if m.project_id is not None]
    if not ids:
        return []
    rows = session.exec(select(Project).where(Project.id.in_(ids)).order_by(Project.id)).all()  # type: ignore[arg-type,union-attr]
    return [_out(p, session) for p in rows]


@router.post("", response_model=ProjectOut, status_code=status.HTTP_201_CREATED)
def create_project(
    body: ProjectCreate,
    current: User = Depends(require_writer),
    session: Session = Depends(get_session),
):
    if current.role not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Manager or admin only")
    if not body.code:
        base = "".join(c for c in body.name.upper() if c.isalnum())[:6] or "PRJ"
        code = f"{base}-{abs(hash(body.name)) % 900 + 100}"
        if not CODE_RE.match(code):
            code = f"PRJ-{abs(hash(body.name)) % 9000 + 1000}"
        body.code = code
    assert body.code is not None
    if not CODE_RE.match(body.code):
        raise HTTPException(status_code=400, detail="Invalid code (A-Z0-9-, 2-12 chars)")
    if session.exec(select(Project).where(Project.code == body.code)).first():
        raise HTTPException(status_code=409, detail="Code exists")
    assert current.id is not None
    project = Project(
        name=body.name,
        code=body.code,
        description=body.description,
        owner_id=current.id,
        start_date=body.start_date,
        target_date=body.target_date,
        status_profile_id=body.status_profile_id,
    )
    session.add(project)
    session.commit()
    session.refresh(project)
    assert project.id is not None
    # auto-membership for creator (unless admin bypass already covers it)
    session.add(ProjectMember(project_id=project.id, user_id=current.id, role=current.role))
    session.commit()
    return _out(project, session)


@router.get("/{project_id}", response_model=ProjectOut)
def get_project(project_id: int, current: User = Depends(get_current_user), session: Session = Depends(get_session)):
    return _out(require_project_access(project_id, current, session), session)


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

    from app.statuses.models import StatusProfile, Status, CustomFieldDef

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

    for s in session.exec(select(Status).where(Status.profile_id == template.id)).all():
        new_s = Status(
            profile_id=proj_profile.id,
            name=s.name,
            color=s.color,
            order=s.order,
            is_done=s.is_done,
            is_blocked=s.is_blocked,
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
