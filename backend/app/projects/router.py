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
    code: str
    description: str = ""
    start_date: str | None = None
    target_date: str | None = None


class ProjectOut(BaseModel):
    id: int
    name: str
    code: str
    description: str


class MemberAdd(BaseModel):
    user_id: int
    role: str = "member"


class MemberOut(BaseModel):
    project_id: int
    user_id: int
    role: str


def _out(p: Project) -> ProjectOut:
    assert p.id is not None
    return ProjectOut(id=p.id, name=p.name, code=p.code, description=p.description)


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
        return [_out(p) for p in rows]
    mrows = session.exec(select(ProjectMember).where(ProjectMember.user_id == current.id)).all()
    ids = [m.project_id for m in mrows if m.project_id is not None]
    if not ids:
        return []
    rows = session.exec(select(Project).where(Project.id.in_(ids)).order_by(Project.id)).all()  # type: ignore[arg-type,union-attr]
    return [_out(p) for p in rows]


@router.post("", response_model=ProjectOut, status_code=status.HTTP_201_CREATED)
def create_project(
    body: ProjectCreate,
    current: User = Depends(require_writer),
    session: Session = Depends(get_session),
):
    if current.role not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Manager or admin only")
    if not CODE_RE.match(body.code):
        raise HTTPException(status_code=400, detail="Invalid code (A-Z0-9-, 2-12 chars)")
    if session.exec(select(Project).where(Project.code == body.code)).first():
        raise HTTPException(status_code=409, detail="Code exists")
    assert current.id is not None
    project = Project(name=body.name, code=body.code, description=body.description, owner_id=current.id,
                      start_date=body.start_date, target_date=body.target_date)
    session.add(project)
    session.commit()
    session.refresh(project)
    assert project.id is not None
    # auto-membership for creator (unless admin bypass already covers it)
    session.add(ProjectMember(project_id=project.id, user_id=current.id, role=current.role))
    session.commit()
    return _out(project)


@router.get("/{project_id}", response_model=ProjectOut)
def get_project(project_id: int, current: User = Depends(get_current_user), session: Session = Depends(get_session)):
    return _out(require_project_access(project_id, current, session))


@router.get("/{project_id}/members", response_model=list[MemberOut])
def list_members(project_id: int, current: User = Depends(get_current_user), session: Session = Depends(get_session)):
    require_project_access(project_id, current, session)
    rows = session.exec(select(ProjectMember).where(ProjectMember.project_id == project_id)).all()
    assert all(r.project_id is not None and r.user_id is not None for r in rows)
    return [MemberOut(project_id=r.project_id or 0, user_id=r.user_id or 0, role=r.role) for r in rows]


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
