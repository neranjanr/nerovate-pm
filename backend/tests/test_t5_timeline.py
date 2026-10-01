"""T5 tests: Execution Timeline API.

Seams under test:
  1. GET /api/v1/tasks/timeline?project_id= returns tasks with depth, parent_id, status, and status_periods.
"""

from fastapi.testclient import TestClient


def test_get_tasks_timeline(client: TestClient, admin_token_headers):
    # Setup status profile & statuses
    r = client.post(
        "/api/v1/status-profiles",
        json={"name": "Timeline Profile", "is_template": True},
        headers=admin_token_headers,
    )
    assert r.status_code == 201
    profile_id = r.json()["id"]

    r = client.post(
        f"/api/v1/status-profiles/{profile_id}/statuses",
        json={"name": "Planning", "order": 0},
        headers=admin_token_headers,
    )
    s1_id = r.json()["id"]

    r = client.post(
        f"/api/v1/status-profiles/{profile_id}/statuses",
        json={"name": "Execution", "order": 1},
        headers=admin_token_headers,
    )
    s2_id = r.json()["id"]

    # Setup project
    r = client.post(
        "/api/v1/projects",
        json={"name": "Timeline Project", "code": "TML-01", "start_date": "2026-03-01"},
        headers=admin_token_headers,
    )
    assert r.status_code == 201
    proj_id = r.json()["id"]

    r = client.post(f"/api/v1/projects/{proj_id}/apply-profile/{profile_id}", headers=admin_token_headers)
    assert r.status_code == 200

    # Get status id
    r = client.get(f"/api/v1/projects/{proj_id}", headers=admin_token_headers)
    sp_id = r.json()["status_profile_id"]
    r = client.get(f"/api/v1/status-profiles/{sp_id}", headers=admin_token_headers)
    statuses = r.json()["statuses"]
    plan_status_id = statuses[0]["id"]
    exec_status_id = statuses[1]["id"]

    # Create root task
    r = client.post(
        "/api/v1/tasks",
        json={
            "project_id": proj_id,
            "title": "Timeline Root Task",
            "start_date": "2026-03-01",
            "due_date": "2026-03-15",
            "status_id": plan_status_id,
        },
        headers=admin_token_headers,
    )
    assert r.status_code == 201
    task1 = r.json()

    # Change status to Execution with period dates
    r = client.post(
        f"/api/v1/tasks/{task1['id']}/status",
        json={
            "status_id": exec_status_id,
            "start_date": "2026-03-05",
            "due_date": "2026-03-20",
        },
        headers=admin_token_headers,
    )
    assert r.status_code == 200

    # Test timeline endpoint
    r = client.get(f"/api/v1/tasks/timeline?project_id={proj_id}", headers=admin_token_headers)
    assert r.status_code == 200
    timeline = r.json()
    assert isinstance(timeline, list)
    assert len(timeline) >= 1
    item = timeline[0]
    assert item["task_id"] == task1["id"]
    assert item["title"] == "Timeline Root Task"
    assert "periods" in item
    assert len(item["periods"]) >= 1
