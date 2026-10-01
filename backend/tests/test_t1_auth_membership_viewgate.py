"""T1 seam tests: auth + membership + view-gate.

Seams under test (pre-agreed):
  1. HTTP API seam: POST /api/v1/auth/login|refresh, GET /me, CRUD /users (admin only)
  2. HTTP membership seam: GET /projects + GET /projects/{id} -> 404 for non-members
  3. Pure function seam: can_access_view(role, view) per SPEC-v0.2 section 3 matrix

All assertions use literals from the spec, never recomputed values.
"""

from fastapi.testclient import TestClient


def _login(client: TestClient, username: str, password: str):
    r = client.post("/api/v1/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    body = r.json()
    assert "access_token" in body and "refresh_token" in body
    assert body["token_type"] == "bearer"
    return body


def test_login_issues_access_and_refresh_tokens(client: TestClient, admin_user):
    body = _login(client, "admin", "adminpass123")
    # refresh flow: 7d refresh -> new 60m access
    r = client.post("/api/v1/auth/refresh", json={"refresh_token": body["refresh_token"]})
    assert r.status_code == 200, r.text
    assert "access_token" in r.json()


def test_login_wrong_password_is_401(client: TestClient, admin_user):
    r = client.post("/api/v1/auth/login", json={"username": "admin", "password": "wrong"})
    assert r.status_code == 401


def test_me_returns_role(client: TestClient, admin_user):
    body = _login(client, "admin", "adminpass123")
    r = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {body['access_token']}"})
    assert r.status_code == 200
    assert r.json()["role"] == "admin"
    assert r.json()["username"] == "admin"


def test_me_without_token_is_401(client: TestClient):
    r = client.get("/api/v1/auth/me")
    assert r.status_code == 401


def test_admin_creates_users_all_roles(client: TestClient, admin_token_headers):
    for role in ["admin", "manager", "member", "guest"]:
        r = client.post(
            "/api/v1/users",
            json={"username": f"u_{role}", "password": "pass12345", "name": role, "role": role},
            headers=admin_token_headers,
        )
        assert r.status_code == 201, r.text
        assert r.json()["role"] == role


def test_non_admin_cannot_create_users(client: TestClient, member_token_headers):
    r = client.post(
        "/api/v1/users",
        json={"username": "nope", "password": "pass12345", "name": "x", "role": "member"},
        headers=member_token_headers,
    )
    assert r.status_code == 403


def test_non_admin_cannot_list_users(client: TestClient, member_token_headers):
    r = client.get("/api/v1/users", headers=member_token_headers)
    assert r.status_code == 403


def test_projects_list_is_membership_filtered(client: TestClient, seeded_projects):
    # member is only in Alpha; guest only in Alpha; outsider in none
    ctx = seeded_projects
    for username, password, expected_codes in [
        ("member1", "pass12345", ["PRC-01"]),
        ("guest1", "pass12345", ["PRC-01"]),
        ("outsider", "pass12345", []),
    ]:
        body = _login(ctx["client"], username, password)
        r = ctx["client"].get(
            "/api/v1/projects", headers={"Authorization": f"Bearer {body['access_token']}"}
        )
        assert r.status_code == 200, r.text
        codes = sorted(p["code"] for p in r.json())
        assert codes == expected_codes


def test_project_detail_non_member_is_404_not_403(client: TestClient, seeded_projects):
    ctx = seeded_projects
    body = _login(ctx["client"], "outsider", "pass12345")
    r = ctx["client"].get(
        f"/api/v1/projects/{ctx['beta_id']}",
        headers={"Authorization": f"Bearer {body['access_token']}"},
    )
    assert r.status_code == 404


def test_guest_is_read_only_on_projects(client: TestClient, seeded_projects):
    ctx = seeded_projects
    body = _login(ctx["client"], "guest1", "pass12345")
    h = {"Authorization": f"Bearer {body['access_token']}"}
    # read own project: OK
    r = ctx["client"].get(f"/api/v1/projects/{ctx['alpha_id']}", headers=h)
    assert r.status_code == 200
    # write: forbidden (guest read + comment only)
    r = ctx["client"].post(
        "/api/v1/projects",
        json={"name": "X", "code": "GX-01"},
        headers=h,
    )
    assert r.status_code in (401, 403)


def test_can_access_view_matrix():
    from app.access import can_access_view

    # List, Board: everyone incl guest
    for role in ["admin", "manager", "member", "guest"]:
        assert can_access_view(role, "board") is True
        assert can_access_view(role, "list") is True
    # Calendar, Table, Dashboard, Timeline: no guest
    for view in ["calendar", "table", "dashboard", "timeline"]:
        assert can_access_view("admin", view) is True
        assert can_access_view("manager", view) is True
        assert can_access_view("member", view) is True
        assert can_access_view("guest", view) is False
    # Workload: admin + manager only
    assert can_access_view("admin", "workload") is True
    assert can_access_view("manager", "workload") is True
    assert can_access_view("member", "workload") is False
    assert can_access_view("guest", "workload") is False
    # Users + templates admin UI: admin only
    for view in ["users", "templates"]:
        assert can_access_view("admin", view) is True
        assert can_access_view("manager", view) is False
        assert can_access_view("member", view) is False
        assert can_access_view("guest", view) is False
    # Settings: admin yes; manager/member/guest via project-level rule -> global
    # function returns False for non-admin (project check happens separately)
    assert can_access_view("admin", "settings") is True
    assert can_access_view("manager", "settings") is False
    assert can_access_view("member", "settings") is False
    assert can_access_view("guest", "settings") is False
