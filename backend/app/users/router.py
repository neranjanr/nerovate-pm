from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlmodel import Session, select

from app.auth.models import User
from app.deps import get_session, require_admin
from app.security import hash_password

router = APIRouter(prefix="/api/v1/users", tags=["users"])

VALID_ROLES = {"admin", "manager", "member", "guest"}


class UserCreate(BaseModel):
    username: str
    password: str
    name: str
    role: str = "member"


class UserUpdate(BaseModel):
    name: str | None = None
    role: str | None = None
    active: bool | None = None
    password: str | None = None


class UserOut(BaseModel):
    id: int
    username: str
    name: str
    role: str
    active: bool


def _out(u: User) -> UserOut:
    assert u.id is not None
    return UserOut(id=u.id, username=u.username, name=u.name, role=u.role, active=u.active)


@router.get("", response_model=list[UserOut])
def list_users(_admin: User = Depends(require_admin), session: Session = Depends(get_session)):
    return [_out(u) for u in session.exec(select(User).order_by(User.id)).all()]  # type: ignore[arg-type]


@router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create_user(body: UserCreate, _admin: User = Depends(require_admin), session: Session = Depends(get_session)):
    if body.role not in VALID_ROLES:
        raise HTTPException(status_code=400, detail="Invalid role")
    if session.exec(select(User).where(User.username == body.username)).first():
        raise HTTPException(status_code=409, detail="Username exists")
    user = User(username=body.username, password_hash=hash_password(body.password), name=body.name, role=body.role, active=True)
    session.add(user)
    session.commit()
    session.refresh(user)
    return _out(user)


@router.get("/{user_id}", response_model=UserOut)
def get_user(user_id: int, _admin: User = Depends(require_admin), session: Session = Depends(get_session)):
    user = session.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="Not found")
    return _out(user)


@router.patch("/{user_id}", response_model=UserOut)
def update_user(user_id: int, body: UserUpdate, _admin: User = Depends(require_admin), session: Session = Depends(get_session)):
    user = session.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="Not found")
    if body.role is not None:
        if body.role not in VALID_ROLES:
            raise HTTPException(status_code=400, detail="Invalid role")
        user.role = body.role
    if body.name is not None:
        user.name = body.name
    if body.active is not None:
        user.active = body.active
    if body.password is not None:
        user.password_hash = hash_password(body.password)
    session.add(user)
    session.commit()
    session.refresh(user)
    return _out(user)
