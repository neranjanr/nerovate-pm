"""Dashboard read-only endpoints (SPEC-v0.2 section 4.5).

View gating mirrors frontend registry.ts:
  dashboard -> admin/manager/member (guest 403)
  workload  -> admin/manager only (member/guest 403)
Membership gate (non-member 404) runs first to avoid enumeration.
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session

from app.access import can_access_view
from app.auth.models import User
from app.dashboard import service as dashboard_service
from app.deps import get_current_user, get_session
from app.projects.router import require_project_access

router = APIRouter(prefix="/api/v1/dashboard", tags=["dashboard"])


class StatusInfo(BaseModel):
    id: int
    name: str
    color: str = ""
    order: int = 0
    is_done: bool = False


class Telemetry(BaseModel):
    tasks_total: int = 0
    periods_total: int = 0
    comments_total: int = 0
    attachments_count: int = 0
    attachments_bytes: int = 0


class SummaryOut(BaseModel):
    project_id: int
    total: int
    by_status: dict[str, int]
    statuses: list[StatusInfo] = []
    overdue: int
    due_soon: int
    blocked: int
    estimate_mins: int = 0
    time_spent_mins: int = 0
    telemetry: Telemetry = Telemetry()
    workload: list[dict] = []


class StorageOut(BaseModel):
    project_id: int
    db_bytes: int = 0
    uploads_bytes: int = 0
    uploads_count: int = 0
    backup_note: str = ""


def _require_dashboard_view(current: User) -> None:
    if not can_access_view(current.role, "dashboard"):
        raise HTTPException(status_code=403, detail="Dashboard view requires member+")


def _require_workload_view(current: User) -> None:
    if not can_access_view(current.role, "workload"):
        raise HTTPException(status_code=403, detail="Workload view requires manager+")


@router.get("/summary", response_model=SummaryOut)
def get_summary(
    project_id: int,
    current: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    require_project_access(project_id, current, session)
    _require_dashboard_view(current)
    data = dashboard_service.summarize(session, project_id)
    # Workload rows respect the view matrix: member sees KPIs only.
    if can_access_view(current.role, "workload"):
        data["workload"] = dashboard_service.workload(session, project_id)
    else:
        data["workload"] = []
    return data


@router.get("/workload", response_model=list[dict])
def get_workload(
    project_id: int,
    current: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    require_project_access(project_id, current, session)
    _require_workload_view(current)
    return dashboard_service.workload(session, project_id)


@router.get("/activity", response_model=list[dict])
def get_activity(
    project_id: int,
    limit: int = 30,
    current: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    require_project_access(project_id, current, session)
    _require_dashboard_view(current)
    return dashboard_service.activity(session, project_id, limit=limit)


@router.get("/storage", response_model=StorageOut)
def get_storage(
    project_id: int,
    current: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    require_project_access(project_id, current, session)
    _require_dashboard_view(current)
    return dashboard_service.storage_info(project_id)
