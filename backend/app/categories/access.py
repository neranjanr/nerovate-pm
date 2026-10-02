"""Hybrid membership helpers (SPEC-v0.3 section 3, ticket U1).

Effective visibility = union (category members see ALL Projects in Category,
plus direct project members see that Project only).
Effective role = max(category role, project role), admin > manager > member > guest.
Non-members get 404 (no enumeration).
"""

from sqlmodel import Session, select

ROLE_RANK: dict[str, int] = {"guest": 1, "member": 2, "manager": 3, "admin": 4}


def max_role(role_a: str, role_b: str) -> str:
    return role_a if ROLE_RANK.get(role_a, 0) >= ROLE_RANK.get(role_b, 0) else role_b


def is_category_member(session: Session, category_id: int, user_id: int):
    from app.categories.models import CategoryMember

    return session.get(CategoryMember, (category_id, user_id))


def category_ids_for_user(session: Session, user_id: int) -> list[int]:
    from app.categories.models import CategoryMember

    rows = session.exec(select(CategoryMember).where(CategoryMember.user_id == user_id)).all()
    return [r.category_id for r in rows if r.category_id is not None]


def _project_category_id(project: object) -> int | None:
    return getattr(project, "category_id", None)


def project_ids_via_categories(session: Session, user_id: int) -> list[int]:
    """Project ids visible through category membership.

    Tolerates pre-U2 databases where projects have no category_id column.
    """
    from app.projects.models import Project

    if "category_id" not in Project.model_fields:
        return []
    cat_ids = category_ids_for_user(session, user_id)
    if not cat_ids:
        return []
    rows = session.exec(select(Project).where(Project.category_id.in_(cat_ids))).all()  # type: ignore[attr-defined,union-attr]
    return [p.id for p in rows if p.id is not None]


def visible_project_ids(session: Session, user_id: int) -> list[int]:
    from app.projects.models import ProjectMember

    direct = session.exec(select(ProjectMember).where(ProjectMember.user_id == user_id)).all()
    ids = {m.project_id for m in direct if m.project_id is not None}
    ids.update(project_ids_via_categories(session, user_id))
    return sorted(ids)


def effective_role_for_project(session: Session, project: object, user_id: int) -> str | None:
    """Max(category role, project role) for a user on a project; None if no membership.

    U1 wires this into read gates (visibility union). Write gates still key off
    the global role (v0.2 behaviour); per-project effective-role writes land with
    U2's category_id wiring.
    """
    from app.projects.models import ProjectMember

    role: str | None = None
    project_id = getattr(project, "id", None)
    if project_id is not None:
        pm = session.get(ProjectMember, (project_id, user_id))
        if pm is not None:
            role = pm.role
    cat_id = _project_category_id(project)
    if cat_id is not None:
        cm = is_category_member(session, cat_id, user_id)
        if cm is not None:
            role = cm.role if role is None else max_role(role, cm.role)
    return role
