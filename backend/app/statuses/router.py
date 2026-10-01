from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlmodel import Session, select

from app.auth.models import User
from app.deps import get_current_user, get_session, require_writer
from app.statuses.models import CustomFieldDef, Status, StatusProfile

router = APIRouter(prefix="/api/v1/status-profiles", tags=["status-profiles"])


class StatusCreate(BaseModel):
    name: str
    color: str = "#6b7280"
    order: int = 0
    is_done: bool = False
    is_blocked: bool = False


class StatusUpdate(BaseModel):
    name: str | None = None
    color: str | None = None
    order: int | None = None
    is_done: bool | None = None
    is_blocked: bool | None = None


class StatusOut(BaseModel):
    id: int
    profile_id: int
    name: str
    color: str
    order: int
    is_done: bool
    is_blocked: bool


class CustomFieldDefCreate(BaseModel):
    key: str
    type: str = "text"
    label: str
    required: bool = False
    order: int = 0


class CustomFieldDefOut(BaseModel):
    id: int
    profile_id: int | None = None
    project_id: int | None = None
    key: str
    type: str
    label: str
    required: bool
    order: int


class StatusProfileCreate(BaseModel):
    name: str
    is_template: bool = True


class StatusProfileUpdate(BaseModel):
    name: str | None = None
    is_template: bool | None = None


class StatusProfileOut(BaseModel):
    id: int
    name: str
    is_template: bool
    created_by: int | None = None
    created_at: str
    statuses: list[StatusOut] = []
    custom_field_defs: list[CustomFieldDefOut] = []


def _profile_out(p: StatusProfile, session: Session) -> StatusProfileOut:
    assert p.id is not None
    st_rows = session.exec(select(Status).where(Status.profile_id == p.id).order_by(Status.order)).all()  # type: ignore[arg-type]
    cf_rows = session.exec(
        select(CustomFieldDef)
        .where((CustomFieldDef.profile_id == p.id) | (CustomFieldDef.project_id == p.id))
        .order_by(CustomFieldDef.order)  # type: ignore[arg-type]
    ).all()
    
    statuses_out = [
        StatusOut(
            id=s.id,  # type: ignore[arg-type]
            profile_id=s.profile_id,
            name=s.name,
            color=s.color,
            order=s.order,
            is_done=s.is_done,
            is_blocked=s.is_blocked,
        )
        for s in st_rows
    ]
    cf_out = [
        CustomFieldDefOut(
            id=c.id,  # type: ignore[arg-type]
            profile_id=c.profile_id,
            project_id=c.project_id,
            key=c.key,
            type=c.type,
            label=c.label,
            required=c.required,
            order=c.order,
        )
        for c in cf_rows
    ]
    return StatusProfileOut(
        id=p.id,
        name=p.name,
        is_template=p.is_template,
        created_by=p.created_by,
        created_at=p.created_at,
        statuses=statuses_out,
        custom_field_defs=cf_out,
    )


@router.get("", response_model=list[StatusProfileOut])
def list_status_profiles(
    current: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    rows = session.exec(select(StatusProfile).order_by(StatusProfile.id)).all()  # type: ignore[arg-type]
    return [_profile_out(p, session) for p in rows]


@router.post("", response_model=StatusProfileOut, status_code=status.HTTP_201_CREATED)
def create_status_profile(
    body: StatusProfileCreate,
    current: User = Depends(require_writer),
    session: Session = Depends(get_session),
):
    if current.role not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Manager or admin only")
    assert current.id is not None
    profile = StatusProfile(
        name=body.name,
        is_template=body.is_template,
        created_by=current.id,
    )
    session.add(profile)
    session.commit()
    session.refresh(profile)
    return _profile_out(profile, session)


@router.get("/{profile_id}", response_model=StatusProfileOut)
def get_status_profile(
    profile_id: int,
    current: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    p = session.get(StatusProfile, profile_id)
    if not p:
        raise HTTPException(status_code=404, detail="Status profile not found")
    return _profile_out(p, session)


@router.put("/{profile_id}", response_model=StatusProfileOut)
def update_status_profile(
    profile_id: int,
    body: StatusProfileUpdate,
    current: User = Depends(require_writer),
    session: Session = Depends(get_session),
):
    if current.role not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Manager or admin only")
    p = session.get(StatusProfile, profile_id)
    if not p:
        raise HTTPException(status_code=404, detail="Status profile not found")
    if body.name is not None:
        p.name = body.name
    if body.is_template is not None:
        p.is_template = body.is_template
    session.add(p)
    session.commit()
    session.refresh(p)
    return _profile_out(p, session)


@router.delete("/{profile_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_status_profile(
    profile_id: int,
    current: User = Depends(require_writer),
    session: Session = Depends(get_session),
):
    if current.role not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Manager or admin only")
    p = session.get(StatusProfile, profile_id)
    if not p:
        raise HTTPException(status_code=404, detail="Status profile not found")
    # delete related statuses and field defs
    for s in session.exec(select(Status).where(Status.profile_id == profile_id)).all():
        session.delete(s)
    for c in session.exec(select(CustomFieldDef).where(CustomFieldDef.profile_id == profile_id)).all():
        session.delete(c)
    session.delete(p)
    session.commit()
    return None


@router.post("/{profile_id}/clone", response_model=StatusProfileOut, status_code=status.HTTP_201_CREATED)
def clone_status_profile(
    profile_id: int,
    current: User = Depends(require_writer),
    session: Session = Depends(get_session),
):
    if current.role not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Manager or admin only")
    p = session.get(StatusProfile, profile_id)
    if not p:
        raise HTTPException(status_code=404, detail="Status profile not found")
    assert current.id is not None
    clone = StatusProfile(
        name=f"{p.name} (Clone)",
        is_template=True,
        created_by=current.id,
    )
    session.add(clone)
    session.commit()
    session.refresh(clone)
    assert clone.id is not None

    # copy statuses
    for s in session.exec(select(Status).where(Status.profile_id == p.id)).all():
        new_s = Status(
            profile_id=clone.id,
            name=s.name,
            color=s.color,
            order=s.order,
            is_done=s.is_done,
            is_blocked=s.is_blocked,
        )
        session.add(new_s)

    # copy custom field defs
    for c in session.exec(select(CustomFieldDef).where(CustomFieldDef.profile_id == p.id)).all():
        new_c = CustomFieldDef(
            profile_id=clone.id,
            project_id=None,
            key=c.key,
            type=c.type,
            label=c.label,
            required=c.required,
            order=c.order,
        )
        session.add(new_c)

    session.commit()
    session.refresh(clone)
    return _profile_out(clone, session)


@router.get("/{profile_id}/statuses", response_model=list[StatusOut])
def list_profile_statuses(
    profile_id: int,
    current: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    p = session.get(StatusProfile, profile_id)
    if not p:
        raise HTTPException(status_code=404, detail="Status profile not found")
    rows = session.exec(select(Status).where(Status.profile_id == profile_id).order_by(Status.order)).all()  # type: ignore[arg-type]
    return [
        StatusOut(
            id=s.id,  # type: ignore[arg-type]
            profile_id=s.profile_id,
            name=s.name,
            color=s.color,
            order=s.order,
            is_done=s.is_done,
            is_blocked=s.is_blocked,
        )
        for s in rows
    ]


@router.post("/{profile_id}/statuses", response_model=StatusOut, status_code=status.HTTP_201_CREATED)
def create_profile_status(
    profile_id: int,
    body: StatusCreate,
    current: User = Depends(require_writer),
    session: Session = Depends(get_session),
):
    if current.role not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Manager or admin only")
    p = session.get(StatusProfile, profile_id)
    if not p:
        raise HTTPException(status_code=404, detail="Status profile not found")
    s = Status(
        profile_id=profile_id,
        name=body.name,
        color=body.color,
        order=body.order,
        is_done=body.is_done,
        is_blocked=body.is_blocked,
    )
    session.add(s)
    session.commit()
    session.refresh(s)
    assert s.id is not None
    return StatusOut(
        id=s.id,
        profile_id=s.profile_id,
        name=s.name,
        color=s.color,
        order=s.order,
        is_done=s.is_done,
        is_blocked=s.is_blocked,
    )


@router.put("/{profile_id}/statuses/{status_id}", response_model=StatusOut)
def update_profile_status(
    profile_id: int,
    status_id: int,
    body: StatusUpdate,
    current: User = Depends(require_writer),
    session: Session = Depends(get_session),
):
    if current.role not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Manager or admin only")
    s = session.get(Status, status_id)
    if not s or s.profile_id != profile_id:
        raise HTTPException(status_code=404, detail="Status not found")
    if body.name is not None:
        s.name = body.name
    if body.color is not None:
        s.color = body.color
    if body.order is not None:
        s.order = body.order
    if body.is_done is not None:
        s.is_done = body.is_done
    if body.is_blocked is not None:
        s.is_blocked = body.is_blocked
    session.add(s)
    session.commit()
    session.refresh(s)
    assert s.id is not None
    return StatusOut(
        id=s.id,
        profile_id=s.profile_id,
        name=s.name,
        color=s.color,
        order=s.order,
        is_done=s.is_done,
        is_blocked=s.is_blocked,
    )


@router.delete("/{profile_id}/statuses/{status_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_profile_status(
    profile_id: int,
    status_id: int,
    current: User = Depends(require_writer),
    session: Session = Depends(get_session),
):
    if current.role not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Manager or admin only")
    s = session.get(Status, status_id)
    if not s or s.profile_id != profile_id:
        raise HTTPException(status_code=404, detail="Status not found")
    session.delete(s)
    session.commit()
    return None


@router.get("/{profile_id}/custom-field-defs", response_model=list[CustomFieldDefOut])
def list_custom_field_defs(
    profile_id: int,
    current: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    p = session.get(StatusProfile, profile_id)
    if not p:
        raise HTTPException(status_code=404, detail="Status profile not found")
    rows = session.exec(select(CustomFieldDef).where(CustomFieldDef.profile_id == profile_id).order_by(CustomFieldDef.order)).all()  # type: ignore[arg-type]
    return [
        CustomFieldDefOut(
            id=c.id,  # type: ignore[arg-type]
            profile_id=c.profile_id,
            project_id=c.project_id,
            key=c.key,
            type=c.type,
            label=c.label,
            required=c.required,
            order=c.order,
        )
        for c in rows
    ]


@router.post("/{profile_id}/custom-field-defs", response_model=CustomFieldDefOut, status_code=status.HTTP_201_CREATED)
def create_custom_field_def(
    profile_id: int,
    body: CustomFieldDefCreate,
    current: User = Depends(require_writer),
    session: Session = Depends(get_session),
):
    if current.role not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Manager or admin only")
    p = session.get(StatusProfile, profile_id)
    if not p:
        raise HTTPException(status_code=404, detail="Status profile not found")
    c = CustomFieldDef(
        profile_id=profile_id,
        project_id=None,
        key=body.key,
        type=body.type,
        label=body.label,
        required=body.required,
        order=body.order,
    )
    session.add(c)
    session.commit()
    session.refresh(c)
    assert c.id is not None
    return CustomFieldDefOut(
        id=c.id,
        profile_id=c.profile_id,
        project_id=c.project_id,
        key=c.key,
        type=c.type,
        label=c.label,
        required=c.required,
        order=c.order,
    )


@router.delete("/{profile_id}/custom-field-defs/{def_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_custom_field_def(
    profile_id: int,
    def_id: int,
    current: User = Depends(require_writer),
    session: Session = Depends(get_session),
):
    if current.role not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Manager or admin only")
    c = session.get(CustomFieldDef, def_id)
    if not c or c.profile_id != profile_id:
        raise HTTPException(status_code=404, detail="Custom field definition not found")
    session.delete(c)
    session.commit()
    return None
