"""T7 tests: Dashboard + Workload API.

Seams under test:
  1. GET /api/v1/dashboard/summary?project_id= -> KPI counts + workload
  2. GET /api/v1/dashboard/workload?project_id= -> capacity rows (admin/manager only)
  3. GET /api/v1/dashboard/activity?project_id= -> status_changed + comment_added events
  4. GET /api/v1/dashboard/storage?project_id= -> on-prem storage card
  5. View gating: guest 403 on dashboard, member 403 on workload, non-member 404.
"""

from datetime import date, timedelta

from fastapi.testclient import TestClient


def _setup_project(client: TestClient, headers):
    r = client.post(
        "/api/v1/status-profiles",
        json={"name": "Dash Profile", "is_template": True},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    profile_id = r.json()["id"]

    r = client.post(
        f"/api/v1/status-profiles/{profile_id}/statuses",
        json={"name": "Todo", "order": 0, "is_done": False},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    r = client.post(
        f"/api/v1/status-profiles/{profile_id}/statuses",
        json={"name": "Done", "order": 1, "is_done": True},
        headers=headers,
    )
    assert r.status_code == 201, r.text

    r = client.post(
        "/api/v1/projects",
        json={"name": "Dash Project", "code": "DSH-01", "start_date": "2026-05-01"},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    proj_id = r.json()["id"]

    r = client.post(f"/api/v1/projects/{proj_id}/apply-profile/{profile_id}", headers=headers)
    assert r.status_code == 200, r.text

    r = client.get(f"/api/v1/projects/{proj_id}", headers=headers)
    sp_id = r.json()["status_profile_id"]
    r = client.get(f"/api/v1/status-profiles/{sp_id}", headers=headers)
    statuses = {s["name"]: s["id"] for s in r.json()["statuses"]}
    return proj_id, statuses


def _mkuser(client: TestClient, headers, username: str, role: str):
    r = client.post(
        "/api/v1/users",
        json={"username": username, "password": "pass12345", "name": username, "role": role},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    uid = r.json()["id"]
    r = client.post("/api/v1/auth/login", json={"username": username, "password": "pass12345"})
    assert r.status_code == 200, r.text
    return uid, {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_dashboard_summary_workload_gating(client: TestClient, admin_token_headers):
    h = admin_token_headers
    proj_id, statuses = _setup_project(client, h)
    todo_id, done_id = statuses["Todo"], statuses["Done"]

    member_id, member_h = _mkuser(client, h, "dashmember", "member")
    guest_id, guest_h = _mkuser(client, h, "dashguest", "guest")
    for uid, role in [(member_id, "member"), (guest_id, "guest")]:
        r = client.post(
            f"/api/v1/projects/{proj_id}/members",
            json={"user_id": uid, "role": role},
            headers=h,
        )
        assert r.status_code == 201, r.text

    today = date.today()
    overdue_due = (today - timedelta(days=1)).isoformat()
    soon_due = (today + timedelta(days=3)).isoformat()

    # Task A: overdue, assigned to member
    r = client.post(
        "/api/v1/tasks",
        json={
            "project_id": proj_id,
            "title": "Overdue task",
            "start_date": "2026-05-01",
            "due_date": overdue_due,
            "status_id": todo_id,
            "assignee_ids": [member_id],
        },
        headers=h,
    )
    assert r.status_code == 201, r.text
    task_a = r.json()["id"]

    # Task B: due soon, assigned to member, blocked by A
    r = client.post(
        "/api/v1/tasks",
        json={
            "project_id": proj_id,
            "title": "Due soon blocked",
            "start_date": "2026-05-01",
            "due_date": soon_due,
            "status_id": todo_id,
            "assignee_ids": [member_id],
            "blocked_by_ids": [task_a],
        },
        headers=h,
    )
    assert r.status_code == 201, r.text
    task_b = r.json()["id"]

    # Task C: done (not overdue even with past due)
    r = client.post(
        "/api/v1/tasks",
        json={
            "project_id": proj_id,
            "title": "Done task",
            "start_date": "2026-05-01",
            "due_date": overdue_due,
            "status_id": done_id,
        },
        headers=h,
    )
    assert r.status_code == 201, r.text

    # comment + status change feed the activity stream
    r = client.post(f"/api/v1/tasks/{task_a}/comments", json={"body_md": "hello"}, headers=h)
    assert r.status_code == 201, r.text

    # --- summary as admin ---
    r = client.get(f"/api/v1/dashboard/summary?project_id={proj_id}", headers=h)
    assert r.status_code == 200, r.text
    summary = r.json()
    assert summary["total"] == 3
    assert summary["overdue"] == 1
    assert summary["due_soon"] == 1
    assert summary["blocked"] == 1
    assert sum(summary["by_status"].values()) == 3
    assert "telemetry" in summary
    wl = {w["user_id"]: w for w in summary["workload"]}
    assert wl[member_id]["open"] == 2
    assert wl[member_id]["overdue"] == 1

    # --- summary as member: KPIs match, workload hidden ---
    r = client.get(f"/api/v1/dashboard/summary?project_id={proj_id}", headers=member_h)
    assert r.status_code == 200, r.text
    msummary = r.json()
    assert msummary["total"] == 3
    assert msummary["overdue"] == 1
    assert msummary["blocked"] == 1
    assert msummary["workload"] == []

    # --- guest: no dashboard view ---
    r = client.get(f"/api/v1/dashboard/summary?project_id={proj_id}", headers=guest_h)
    assert r.status_code == 403, r.text

    # --- workload endpoint: admin ok, member/guest forbidden ---
    r = client.get(f"/api/v1/dashboard/workload?project_id={proj_id}", headers=h)
    assert r.status_code == 200, r.text
    assert any(w["user_id"] == member_id for w in r.json())

    r = client.get(f"/api/v1/dashboard/workload?project_id={proj_id}", headers=member_h)
    assert r.status_code == 403, r.text
    r = client.get(f"/api/v1/dashboard/workload?project_id={proj_id}", headers=guest_h)
    assert r.status_code == 403, r.text

    # --- blocked task id sanity ---
    assert task_b is not None

    # --- activity stream has both event kinds ---
    r = client.get(f"/api/v1/dashboard/activity?project_id={proj_id}", headers=h)
    assert r.status_code == 200, r.text
    kinds = {e["kind"] for e in r.json()}
    assert "task.status_changed" in kinds
    assert "task.comment_added" in kinds

    # --- storage card ---
    r = client.get(f"/api/v1/dashboard/storage?project_id={proj_id}", headers=h)
    assert r.status_code == 200, r.text
    assert "db_bytes" in r.json()
    assert "uploads_bytes" in r.json()

    # --- non-member gets 404 (no enumeration) ---
    _, outsider_h = _mkuser(client, h, "dashoutsider", "member")
    r = client.get(f"/api/v1/dashboard/summary?project_id={proj_id}", headers=outsider_h)
    assert r.status_code == 404, r.text
