from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlmodel import Session, select

from app.auth.models import User
from app.deps import get_current_user, get_session
from app.security import create_access_token, create_refresh_token, decode_token, hash_password, verify_password


router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


class LoginIn(BaseModel):
    username: str
    password: str


class RefreshIn(BaseModel):
    refresh_token: str


class UserOut(BaseModel):
    id: int
    username: str
    name: str
    role: str
    active: bool


class MeUpdateIn(BaseModel):
    name: str


class ChangePasswordIn(BaseModel):
    current_password: str
    new_password: str


@router.post("/login")
def login(body: LoginIn, session: Session = Depends(get_session)):
    user = session.exec(select(User).where(User.username == body.username)).first()
    if user is None or not user.active or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    assert user.id is not None
    return {
        "access_token": create_access_token(user.id),
        "refresh_token": create_refresh_token(user.id),
        "token_type": "bearer",
    }


@router.post("/refresh")
def refresh(body: RefreshIn, session: Session = Depends(get_session)):
    try:
        payload = decode_token(body.refresh_token)
    except Exception:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")
    if payload.get("type") != "refresh":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not a refresh token")
    user = session.get(User, int(payload["sub"]))
    if user is None or not user.active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User inactive")
    assert user.id is not None
    return {
        "access_token": create_access_token(user.id),
        "refresh_token": create_refresh_token(user.id),
        "token_type": "bearer",
    }


@router.get("/me", response_model=UserOut)
def me(current: User = Depends(get_current_user)):
    assert current.id is not None
    return UserOut(id=current.id, username=current.username, name=current.name, role=current.role, active=current.active)


@router.patch("/me", response_model=UserOut)
def update_me(
    body: MeUpdateIn,
    current: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    name = body.name.strip()
    if not name or len(name) > 128:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Name must be 1-128 chars")
    current.name = name
    session.add(current)
    session.commit()
    session.refresh(current)
    assert current.id is not None
    return UserOut(id=current.id, username=current.username, name=current.name, role=current.role, active=current.active)


@router.post("/me/change-password")
def change_password(
    body: ChangePasswordIn,
    current: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    if not verify_password(body.current_password, current.password_hash):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect")
    if len(body.new_password) < 8 or len(body.new_password) > 128:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="New password must be 8-128 chars")
    current.password_hash = hash_password(body.new_password)
    session.add(current)
    session.commit()
    return {"ok": True}
