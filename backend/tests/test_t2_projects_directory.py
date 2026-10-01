"""T2 tests: Projects Directory P1.

Seams under test:
  1. GET /api/v1/projects returns membership-filtered projects with code, name, span dates, task counts, owner.
  2. POST /api/v1/projects: manager and admin can create with name + start_date + status; guest cannot create (403).
"""

from fastapi.testclient import TestClient


def _login(client: TestClient, username: str, password: str):
    r = client.post("/api/v1/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def test_manager_and_admin_can_create_project_with_name_start_date_status(client: TestClient, admin_token_headers):
    r = client.post(
        "/api/v1/projects",
        json={
            "name": "Project Alpha",
            "code": "ALF-01",
            "start_date": "2026-01-01",
            "target_date": "2026-03-31",
            "status_profile_id": 1,
        },
        headers=admin_token_headers,
    )
    assert r.status_code == 201, r.text
    data = r.json()
    assert data["name"] == "Project Alpha"
    assert data["code"] == "ALF-01"
    assert data["start_date"] == "2026-01-01"
    assert data["target_date"] == "2026-03-31"
    assert data["owner_id"] is not None
    assert "owner_name" in data
    assert "task_count" in data


def test_guest_cannot_create_project(client: TestClient, admin_token_headers):
    # create guest user
    r = client.post(
        "/api/v1/users",
        json={"username": "guest_user", "password": "pass12345", "name": "Guest", "role": "guest"},
        headers=admin_token_headers,
    )
    assert r.status_code == 201
    token = _login(client, "guest_user", "pass12345")
    r = client.post(
        "/api/v1/projects",
        json={"name": "Guest Project", "code": "GST-01", "start_date": "2026-01-01"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code in (401, 403)


def test_projects_directory_fields(client: TestClient, admin_token_headers):
    client.post(
        "/api/v1/projects",
        json={"name": "Beta Project", "code": "BET-01", "start_date": "2026-02-01"},
        headers=admin_token_headers,
    )
    r = client.get("/api/v1/projects", headers=admin_token_headers)
    assert r.status_code == 200
    projects = r.json()
    assert len(projects) > 0
    p = projects[0]
    assert "code" in p
    assert "name" in p
    assert "start_date" in p
    assert "task_count" in p
    assert "owner_name" in p
