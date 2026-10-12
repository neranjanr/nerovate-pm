from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlmodel import Session, select

from app.auth.models import User
from app.deps import get_current_user, get_session, require_writer
from app.statuses.models import CustomFieldDef, Status, StatusProfile, StatusStage
from app.statuses.signals import BLOCKED, NORMAL, normalize_kind

router = APIRouter(prefix="/api/v1/status-profiles", tags=["status-profiles"])
stages_router = APIRouter(prefix="/api/v1/stages", tags=["status-stages"])
statuses_router = APIRouter(prefix="/api/v1/statuses", tags=["statuses"])


def _tint_hex(base: str, idx: int, total: int) -> str:
    """Tier-2 cascade shade: first leaf = lightest tint (~85% toward white),
    last leaf = solid base. Cycles with dark-shift handled by caller via idx."""
    try:
        h = base.lstrip("#")
        if len(h) == 3:
            h = "".join(c * 2 for c in h)
        r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    except Exception:
        return base
    total = max(total, 1)
    # Q4 cascade: light -> solid across position.
    f = 0.0 if total <= 1 else 0.85 - (idx / (total - 1)) * 0.85
    # Cycle for 5th+ statuses: reuse ramp (caller passes idx % total window).
    f = max(0.0, min(0.85, f))
    r = round(r + (255 - r) * f)
    g = round(g + (255 - g) * f)
    b = round(b + (255 - b) * f)
    return f"#{r:02x}{g:02x}{b:02x}"


def _recascade_stage(session: Session, stage: StatusStage) -> None:
    """Recompute stored color/shade for all child statuses of a stage."""
    assert stage.id is not None
    rows = list(
        session.exec(
            select(Status).where(Status.stage_id == stage.id).order_by(Status.order)  # type: ignore[arg-type]
        ).all()
    )
    total = max(len(rows), 1)
    for idx, s in enumerate(rows):
        shade = _tint_hex(stage.color_base, idx % 4 if len(rows) > 4 else idx, min(total, 4) if len(rows) > 4 else total)
        s.color = shade
        s.shade = shade
        session.add(s)


class StatusCreate(BaseModel):
    name: str
    color: str | None = None
    order: int = 0
    is_done: bool = False
    is_blocked: bool = False
    kind: str = NORMAL
    is_milestone: bool = False
    active: bool = True
    stage_id: int | None = None
    shade: str | None = None


class StatusUpdate(BaseModel):
    name: str | None = None
    color: str | None = None
    order: int | None = None
    is_done: bool | None = None
    is_blocked: bool | None = None
    kind: str | None = None
    is_milestone: bool | None = None
    active: bool | None = None
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
    kind: str = NORMAL
    is_milestone: bool = False
    active: bool = True


class StageCreate(BaseModel):
    name: str
    order: int = 0
    color_base: str = "#6b7280"
    description: str = ""
    active: bool = True


class StageUpdate(BaseModel):
    name: str | None = None
    order: int | None = None
    color_base: str | None = None
    description: str | None = None
    active: bool | None = None


class StageOut(BaseModel):
    id: int
    profile_id: int
    name: str
    order: int
    color_base: str
    description: str = ""
    active: bool = True


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
    description: str = ""
    active: bool = True
    is_template: bool = True


class StatusProfileUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    active: bool | None = None
    is_template: bool | None = None


class StatusProfileOut(BaseModel):
    id: int
    name: str
    description: str = ""
    active: bool = True
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
        description=getattr(s, "description", "") or "",
        active=getattr(s, "active", True),
    )


def _status_out(s: Status) -> StatusOut:
    assert s.id is not None
    kind = getattr(s, "kind", None) or (BLOCKED if s.is_blocked else NORMAL)
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
        kind=kind,
        is_milestone=getattr(s, "is_milestone", False) or False,
        active=getattr(s, "active", True),
    )


def _require_kind(value: str | None) -> str:
    """Validate an incoming kind payload; 422 on unknown kinds."""
    try:
        return normalize_kind(value)
    except ValueError:
        raise HTTPException(status_code=422, detail=f"Unknown status kind: {value!r}")


def _kind_for_create(body: StatusCreate) -> tuple[str, bool]:
    """Resolve (kind, is_blocked) for a new Status.

    Explicit kind wins; legacy is_blocked=True backfills to blocked kind;
    blocked kind keeps the row/border treatment flag in sync.
    """
    kind = _require_kind(body.kind)
    is_blocked = body.is_blocked
    if kind == NORMAL and is_blocked:
        kind = BLOCKED
    if kind == BLOCKED:
        is_blocked = True
    return kind, is_blocked


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
        description=getattr(p, "description", "") or "",
        active=getattr(p, "active", True),
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
        description=body.description,
        active=body.active,
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
    if body.description is not None:
        p.description = body.description
    if body.active is not None:
        p.active = body.active
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
        description=getattr(p, "description", "") or "",
        active=getattr(p, "active", True),
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
            description=getattr(st, "description", "") or "",
            active=getattr(st, "active", True),
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
            kind=getattr(s, "kind", None) or NORMAL,
            is_milestone=getattr(s, "is_milestone", False) or False,
            active=getattr(s, "active", True),
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
        description=body.description,
        active=body.active,
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
    if body.description is not None:
        st.description = body.description
    if body.active is not None:
        st.active = body.active
    session.add(st)
    session.commit()
    session.refresh(st)
    # Q4: Tier-1 recolor cascades to Tier-2 shades.
    if body.color_base is not None:
        _recascade_stage(session, st)
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
    # Q4: Tier-2 shade derived from Tier-1 base + position (read-only cascade).
    siblings = list(
        session.exec(select(Status).where(Status.stage_id == stage_id).order_by(Status.order)).all()  # type: ignore[arg-type]
    )
    shade = _tint_hex(st.color_base, len(siblings) % 4 if len(siblings) >= 4 else len(siblings), 4)
    kind, is_blocked = _kind_for_create(body)
    s = Status(
        profile_id=st.profile_id,
        stage_id=stage_id,
        name=name,
        color=shade,
        shade=shade,
        order=order,
        is_done=body.is_done,
        is_blocked=is_blocked,
        kind=kind,
        is_milestone=body.is_milestone,
        active=body.active,
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
    # Q4 cascade: derive shade from parent stage base when staged.
    shade = body.shade
    color = body.color
    if stage is not None:
        siblings = list(
            session.exec(select(Status).where(Status.stage_id == stage.id).order_by(Status.order)).all()  # type: ignore[arg-type]
        )
        derived = _tint_hex(stage.color_base, len(siblings) % 4 if len(siblings) >= 4 else len(siblings), 4)
        shade = derived
        color = derived
    elif shade is None:
        shade = color
    kind, is_blocked = _kind_for_create(body)
    s = Status(
        profile_id=profile_id,
        stage_id=body.stage_id,
        name=name,
        color=color or "#6b7280",
        shade=shade,
        order=order,
        is_done=body.is_done,
        is_blocked=is_blocked,
        kind=kind,
        is_milestone=body.is_milestone,
        active=body.active,
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
    if body.kind is not None:
        # Explicit kind wins and keeps the treatment flag in sync.
        s.kind = _require_kind(body.kind)
        s.is_blocked = s.kind == BLOCKED
    elif body.is_blocked is not None:
        s.is_blocked = body.is_blocked
        current_kind = getattr(s, "kind", None) or NORMAL
        if body.is_blocked and current_kind == NORMAL:
            s.kind = BLOCKED
        elif not body.is_blocked and current_kind == BLOCKED:
            s.kind = NORMAL
    if body.is_milestone is not None:
        s.is_milestone = body.is_milestone
    if body.active is not None:
        s.active = body.active
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
    # Recascade siblings when order changes so positional shades stay correct.
    if body.order is not None and s.stage_id is not None:
        st = session.get(StatusStage, s.stage_id)
        if st is not None:
            _recascade_stage(session, st)
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
