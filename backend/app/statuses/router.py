from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlmodel import Session, select

from app.auth.models import User
from app.deps import get_current_user, get_session, require_writer
from app.statuses.models import CustomFieldDef, Status, StatusProfile, StatusStage

router = APIRouter(prefix="/api/v1/status-profiles", tags=["status-profiles"])
stages_router = APIRouter(prefix="/api/v1/stages", tags=["status-stages"])
statuses_router = APIRouter(prefix="/api/v1/statuses", tags=["statuses"])


def _tint_hex(base: str, idx: int, total: int) -> str:
    """Lighten a hex color toward white by position (auto-tinted leaf shades)."""
    try:
        h = base.lstrip("#")
        if len(h) == 3:
            h = "".join(c * 2 for c in h)
        r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    except Exception:
        return base
    total = max(total, 1)
    # First leaf keeps the base; later leaves lighten up to ~45% toward white.
    f = 0.0 if total <= 1 else (idx / (total - 1)) * 0.45
    r = round(r + (255 - r) * f)
    g = round(g + (255 - g) * f)
    b = round(b + (255 - b) * f)
    return f"#{r:02x}{g:02x}{b:02x}"


class StatusCreate(BaseModel):
    name: str
    color: str = "#6b7280"
    order: int = 0
    is_done: bool = False
    is_blocked: bool = False
    stage_id: int | None = None
    shade: str | None = None


class StatusUpdate(BaseModel):
    name: str | None = None
    color: str | None = None
    order: int | None = None
    is_done: bool | None = None
    is_blocked: bool | None = None
    stage_id: int | None = None
    shade: str | None = None


class StatusOut(BaseModel):
    id: int
    profile_id: int
    stage_id: int | None = None
    name: str
    color: str
    shade: str | None = None
    order: int
    is_done: bool
    is_blocked: bool


class StageCreate(BaseModel):
    name: str
    order: int = 0
    color_base: str = "#6b7280"


class StageUpdate(BaseModel):
    name: str | None = None
    order: int | None = None
    color_base: str | None = None


class StageOut(BaseModel):
    id: int
    profile_id: int
    name: str
    order: int
    color_base: str


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
    stages: list[StageOut] = []
    statuses: list[StatusOut] = []
    custom_field_defs: list[CustomFieldDefOut] = []


def _stage_out(s: StatusStage) -> StageOut:
    assert s.id is not None
    return StageOut(
        id=s.id,
        profile_id=s.profile_id,
        name=s.name,
        order=s.order,
        color_base=s.color_base,
    )


def _status_out(s: Status) -> StatusOut:
    assert s.id is not None
    return StatusOut(
        id=s.id,
        profile_id=s.profile_id,
        stage_id=s.stage_id,
        name=s.name,
        color=s.color,
        shade=s.shade,
        order=s.order,
        is_done=s.is_done,
        is_blocked=s.is_blocked,
    )


def _ordered_stages(session: Session, profile_id: int) -> list[StatusStage]:
    return list(
        session.exec(
            select(StatusStage).where(StatusStage.profile_id == profile_id).order_by(StatusStage.order)  # type: ignore[arg-type]
        ).all()
    )


def _ordered_statuses(session: Session, profile_id: int) -> list[Status]:
    return list(
        session.exec(
            select(Status).where(Status.profile_id == profile_id).order_by(Status.order)  # type: ignore[arg-type]
        ).all()
    )


def _next_stage_order(session: Session, profile_id: int) -> int:
    rows = _ordered_stages(session, profile_id)
    return (max((s.order for s in rows), default=0) + 1) if rows else 1


def _next_status_order(session: Session, profile_id: int, stage_id: int | None) -> int:
    if stage_id is not None:
        rows = session.exec(select(Status).where(Status.stage_id == stage_id)).all()
    else:
        rows = session.exec(select(Status).where(Status.profile_id == profile_id)).all()
    return (max((s.order for s in rows), default=0) + 1) if rows else 1


def _resolve_stage(session: Session, profile_id: int, stage_id: int | None) -> StatusStage | None:
    if stage_id is None:
        return None
    st = session.get(StatusStage, stage_id)
    if st is None or st.profile_id != profile_id:
        raise HTTPException(status_code=400, detail="Invalid stage_id for this profile")
    return st


def _profile_out(p: StatusProfile, session: Session) -> StatusProfileOut:
    assert p.id is not None
    st_rows = _ordered_statuses(session, p.id)
    cf_rows = session.exec(
        select(CustomFieldDef)
        .where((CustomFieldDef.profile_id == p.id) | (CustomFieldDef.project_id == p.id))
        .order_by(CustomFieldDef.order)  # type: ignore[arg-type]
    ).all()

    statuses_out = [_status_out(s) for s in st_rows]
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
        stages=[_stage_out(s) for s in _ordered_stages(session, p.id)],
        statuses=statuses_out,
        custom_field_defs=cf_out,
    )


def _delete_status_with_remap(
    session: Session, target: Status, replacement_id: int | None, actor_id: int | None
) -> None:
    """Enforce U3 delete rule: 409 with usage counts, or remap + history."""
    from sqlalchemy import func

    from app.tasks.models import Task, TaskHistory, TaskStatusPeriod

    assert target.id is not None
    usage_tasks = int(
        session.exec(
            select(func.count()).select_from(Task).where(Task.status_id == target.id)
        ).one()
    )
    usage_periods = int(
        session.exec(
            select(func.count())
            .select_from(TaskStatusPeriod)
            .where(TaskStatusPeriod.status_id == target.id)
        ).one()
    )
    if usage_tasks > 0 or usage_periods > 0:
        if replacement_id is None:
            raise HTTPException(
                status_code=409,
                detail={
                    "message": "Status in use; replacement_id required",
                    "usage_tasks": usage_tasks,
                    "usage_periods": usage_periods,
                },
            )
        if replacement_id == target.id:
            raise HTTPException(status_code=400, detail="replacement_id must differ")
        replacement = session.get(Status, replacement_id)
        if replacement is None or replacement.profile_id != target.profile_id:
            raise HTTPException(
                status_code=400, detail="replacement_id must be in the same profile"
            )
        assert replacement.id is not None
        # Remap live tasks; retain old periods for history; write history rows.
        affected = session.exec(select(Task).where(Task.status_id == target.id)).all()
        for t in affected:
            assert t.id is not None
            old = t.status_id
            t.status_id = replacement.id
            session.add(t)
            session.add(
                TaskHistory(
                    task_id=t.id,
                    from_status_id=old,
                    to_status_id=replacement.id,
                    actor_id=actor_id,
                )
            )
        session.commit()
    session.delete(target)
    session.commit()


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
    # delete related stages, statuses and field defs
    for st in session.exec(select(StatusStage).where(StatusStage.profile_id == profile_id)).all():
        session.delete(st)
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

    # copy stages (preserve order/color), mapping old -> new ids
    stage_map: dict[int, int] = {}
    for st in session.exec(select(StatusStage).where(StatusStage.profile_id == p.id)).all():
        assert st.id is not None
        new_st = StatusStage(
            profile_id=clone.id,
            name=st.name,
            order=st.order,
            color_base=st.color_base,
        )
        session.add(new_st)
        session.commit()
        session.refresh(new_st)
        assert new_st.id is not None
        stage_map[st.id] = new_st.id

    # copy statuses
    for s in session.exec(select(Status).where(Status.profile_id == p.id)).all():
        new_stage_id = stage_map.get(s.stage_id) if s.stage_id is not None else None
        new_s = Status(
            profile_id=clone.id,
            stage_id=new_stage_id,
            name=s.name,
            color=s.color,
            shade=s.shade,
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


# ---- Stages (U3) ----


@router.get("/{profile_id}/stages", response_model=list[StageOut])
def list_profile_stages(
    profile_id: int,
    current: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    p = session.get(StatusProfile, profile_id)
    if not p:
        raise HTTPException(status_code=404, detail="Status profile not found")
    return [_stage_out(s) for s in _ordered_stages(session, profile_id)]


@router.post("/{profile_id}/stages", response_model=StageOut, status_code=status.HTTP_201_CREATED)
def create_profile_stage(
    profile_id: int,
    body: StageCreate,
    current: User = Depends(require_writer),
    session: Session = Depends(get_session),
):
    if current.role not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Manager or admin only")
    p = session.get(StatusProfile, profile_id)
    if not p:
        raise HTTPException(status_code=404, detail="Status profile not found")
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name required")
    order = body.order if body.order else _next_stage_order(session, profile_id)
    st = StatusStage(
        profile_id=profile_id,
        name=name,
        order=order,
        color_base=body.color_base or "#6b7280",
    )
    session.add(st)
    session.commit()
    session.refresh(st)
    return _stage_out(st)


@stages_router.get("/{stage_id}", response_model=StageOut)
def get_stage(
    stage_id: int,
    current: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    st = session.get(StatusStage, stage_id)
    if not st:
        raise HTTPException(status_code=404, detail="Stage not found")
    return _stage_out(st)


@stages_router.put("/{stage_id}", response_model=StageOut)
def update_stage(
    stage_id: int,
    body: StageUpdate,
    current: User = Depends(require_writer),
    session: Session = Depends(get_session),
):
    if current.role not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Manager or admin only")
    st = session.get(StatusStage, stage_id)
    if not st:
        raise HTTPException(status_code=404, detail="Stage not found")
    if body.name is not None:
        name = body.name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="Name required")
        st.name = name
    if body.order is not None:
        st.order = body.order
    if body.color_base is not None:
        st.color_base = body.color_base
    session.add(st)
    session.commit()
    session.refresh(st)
    return _stage_out(st)


@stages_router.delete("/{stage_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_stage(
    stage_id: int,
    current: User = Depends(require_writer),
    session: Session = Depends(get_session),
):
    if current.role not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Manager or admin only")
    st = session.get(StatusStage, stage_id)
    if not st:
        raise HTTPException(status_code=404, detail="Stage not found")
    remaining = session.exec(select(Status).where(Status.stage_id == stage_id)).all()
    if remaining:
        raise HTTPException(
            status_code=409,
            detail={
                "message": "Stage contains statuses; move or delete them first",
                "usage_statuses": len(remaining),
            },
        )
    session.delete(st)
    session.commit()
    return None


@stages_router.get("/{stage_id}/statuses", response_model=list[StatusOut])
def list_stage_statuses(
    stage_id: int,
    current: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    st = session.get(StatusStage, stage_id)
    if not st:
        raise HTTPException(status_code=404, detail="Stage not found")
    rows = session.exec(
        select(Status).where(Status.stage_id == stage_id).order_by(Status.order)  # type: ignore[arg-type]
    ).all()
    return [_status_out(s) for s in rows]


@stages_router.post("/{stage_id}/statuses", response_model=StatusOut, status_code=status.HTTP_201_CREATED)
def create_stage_status(
    stage_id: int,
    body: StatusCreate,
    current: User = Depends(require_writer),
    session: Session = Depends(get_session),
):
    if current.role not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Manager or admin only")
    st = session.get(StatusStage, stage_id)
    if not st:
        raise HTTPException(status_code=404, detail="Stage not found")
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name required")
    order = body.order if body.order else _next_status_order(session, st.profile_id, stage_id)
    shade = body.shade if body.shade is not None else st.color_base
    s = Status(
        profile_id=st.profile_id,
        stage_id=stage_id,
        name=name,
        color=body.color,
        shade=shade,
        order=order,
        is_done=body.is_done,
        is_blocked=body.is_blocked,
    )
    session.add(s)
    session.commit()
    session.refresh(s)
    return _status_out(s)


# ---- Statuses with stage_id (U3) ----


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
    return [_status_out(s) for s in rows]


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
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name required")
    stage = _resolve_stage(session, profile_id, body.stage_id)
    order = body.order if body.order else _next_status_order(session, profile_id, body.stage_id)
    shade = body.shade
    if shade is None and stage is not None:
        shade = stage.color_base
    s = Status(
        profile_id=profile_id,
        stage_id=body.stage_id,
        name=name,
        color=body.color,
        shade=shade,
        order=order,
        is_done=body.is_done,
        is_blocked=body.is_blocked,
    )
    session.add(s)
    session.commit()
    session.refresh(s)
    return _status_out(s)


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
        name = body.name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="Name required")
        s.name = name
    if body.color is not None:
        s.color = body.color
    if body.order is not None:
        s.order = body.order
    if body.is_done is not None:
        s.is_done = body.is_done
    if body.is_blocked is not None:
        s.is_blocked = body.is_blocked
    if "stage_id" in body.model_fields_set:
        _resolve_stage(session, profile_id, body.stage_id)
        s.stage_id = body.stage_id
        if body.shade is None and body.stage_id is not None and s.shade is None:
            st = session.get(StatusStage, body.stage_id)
            if st is not None:
                s.shade = st.color_base
    if body.shade is not None:
        s.shade = body.shade
    session.add(s)
    session.commit()
    session.refresh(s)
    return _status_out(s)


@router.delete(
    "/{profile_id}/statuses/{status_id}", status_code=status.HTTP_204_NO_CONTENT
)
def delete_profile_status(
    profile_id: int,
    status_id: int,
    replacement_id: int | None = Query(default=None),
    current: User = Depends(require_writer),
    session: Session = Depends(get_session),
):
    if current.role not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Manager or admin only")
    s = session.get(Status, status_id)
    if not s or s.profile_id != profile_id:
        raise HTTPException(status_code=404, detail="Status not found")
    assert current.id is not None
    _delete_status_with_remap(session, s, replacement_id, current.id)
    return None


@statuses_router.get("/{status_id}", response_model=StatusOut)
def get_status(
    status_id: int,
    current: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    s = session.get(Status, status_id)
    if not s:
        raise HTTPException(status_code=404, detail="Status not found")
    return _status_out(s)


@statuses_router.delete("/{status_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_status(
    status_id: int,
    replacement_id: int | None = Query(default=None),
    current: User = Depends(require_writer),
    session: Session = Depends(get_session),
):
    if current.role not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Manager or admin only")
    s = session.get(Status, status_id)
    if not s:
        raise HTTPException(status_code=404, detail="Status not found")
    assert current.id is not None
    _delete_status_with_remap(session, s, replacement_id, current.id)
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
