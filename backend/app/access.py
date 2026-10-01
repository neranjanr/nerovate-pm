"""Shared view-access matrix (SPEC-v0.2 section 3).

Two-axis visibility:
  1. project_members decides which Projects you see (enforced in projects router).
  2. Global role decides which views/tabs are visible (enforced backend + frontend).

Global can_access_view() covers the role axis only. Settings needs an
additional project-level check (manager of that Project), handled by
can_access_settings() in deps.
"""

from typing import Literal

Role = Literal["admin", "manager", "member", "guest"]
ViewId = Literal[
    "board", "list", "calendar", "table", "timeline", "dashboard", "workload", "settings", "users", "templates"
]

# Global role -> views. Settings is special: global admin only here;
# managers gain settings per-Project via project membership (see can_access_settings).
_MATRIX: dict[str, set[str]] = {
    "admin": {"board", "list", "calendar", "table", "timeline", "dashboard", "workload", "settings", "users", "templates"},
    "manager": {"board", "list", "calendar", "table", "timeline", "dashboard", "workload"},
    "member": {"board", "list", "calendar", "table", "timeline", "dashboard"},
    "guest": {"board", "list"},
}

ALL_VIEWS: list[str] = ["board", "list", "calendar", "table", "timeline", "dashboard", "workload", "settings", "users", "templates"]


def can_access_view(role: str, view: str) -> bool:
    """Return True if global role grants view. Unknown roles/views -> False."""
    allowed = _MATRIX.get(role)
    if allowed is None:
        return False
    return view in allowed
