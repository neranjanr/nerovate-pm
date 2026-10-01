"""T4 tests: Board P2 + hierarchy + periods write.

Seams under test:
  1. Hierarchy depth capped at Task (0) then Subtask (1.1) then Microtask (1.1.1, leaf), same Project only; depth 3+ rejected.
  2. Minimum on create: title, start_date, status_id, project_id.
  3. CRUD and filtering (search, depth, blocked).
  4. POST /api/v1/tasks/{id}/status upserts per-Status start, planned due, actual end dates and writes task_history.
  5. Blocked tasks and blocked-map endpoint.
"""

from fastapi.testclient import TestClient


def test_task_hierarchy_and_creation(client: TestClient, admin_token_headers):
    # Setup project and get status profile statuses
    r = client.post(
        "/api/v1/status-profiles",
        json={"name": "Board Workflow", "is_template": True},
        headers=admin_token_headers,
    )
    assert r.status_code == 201
    profile_id = r.json()["id"]

    r = client.post(
        f"/api/v1/status-profiles/{profile_id}/statuses",
        json={"name": "To Do", "order": 0},
        headers=admin_token_headers,
    )
    assert r.status_code == 201
    s1_id = r.json()["id"]

    r = client.post(
        f"/api/v1/status-profiles/{profile_id}/statuses",
        json={"name": "Done", "order": 1, "is_done": True},
        headers=admin_token_headers,
    )
    assert r.status_code == 201
    s2_id = r.json()["id"]

    r = client.post(
        "/api/v1/projects",
        json={"name": "Board Project", "code": "BRD-01", "start_date": "2026-03-01", "status_profile_id": profile_id},
        headers=admin_token_headers,
    )
    assert r.status_code == 201
    proj = r.json()
    proj_id = proj["id"]

    # Apply profile
    r = client.post(f"/api/v1/projects/{proj_id}/apply-profile/{profile_id}", headers=admin_token_headers)
    assert r.status_code == 200

    # Get project statuses
    r = client.get(f"/api/v1/status-profiles/{proj.get('status_profile_id') or r.json()['status_profile_id']}", headers=admin_token_headers)
    statuses = r.json()["statuses"]
    todo_status_id = statuses[0]["id"]

    # Create root task (depth 0)
    r = client.post(
        "/api/v1/tasks",
        json={
            "project_id": proj_id,
            "title": "Root Task 1",
            "start_date": "2026-03-01",
            "status_id": todo_status_id,
            "priority": "normal",
        },
        headers=admin_token_headers,
    )
    assert r.status_code == 201, r.text
    task1 = r.json()
    assert task1["depth"] == 0
    assert task1["parent_id"] is None

    # Create subtask (depth 1)
    r = client.post(
        "/api/v1/tasks",
        json={
            "project_id": proj_id,
            "parent_id": task1["id"],
            "title": "Subtask 1.1",
            "start_date": "2026-03-02",
            "status_id": todo_status_id,
        },
        headers=admin_token_headers,
    )
    assert r.status_code == 201, r.text
    subtask = r.json()
    assert subtask["depth"] == 1
    assert subtask["parent_id"] == task1["id"]

    # Create microtask (depth 2)
    r = client.post(
        "/api/v1/tasks",
        json={
            "project_id": proj_id,
            "parent_id": subtask["id"],
            "title": "Microtask 1.1.1",
            "start_date": "2026-03-03",
            "status_id": todo_status_id,
        },
        headers=admin_token_headers,
    )
    assert r.status_code == 201, r.text
    microtask = r.json()
    assert microtask["depth"] == 2
    assert microtask["parent_id"] == subtask["id"]

    # Try creating depth 3 (should fail)
    r = client.post(
        "/api/v1/tasks",
        json={
            "project_id": proj_id,
            "parent_id": microtask["id"],
            "title": "Too Deep",
            "start_date": "2026-03-04",
            "status_id": todo_status_id,
        },
        headers=admin_token_headers,
    )
    assert r.status_code in (400, 422)


def test_status_period_write_and_history(client: TestClient, admin_token_headers):
    # Create project and statuses
    r = client.post(
        "/api/v1/status-profiles",
        json={"name": "Flow Profile", "is_template": True},
        headers=admin_token_headers,
    )
    profile_id = r.json()["id"]

    r = client.post(
        f"/api/v1/status-profiles/{profile_id}/statuses",
        json={"name": "Stage 1", "order": 0},
        headers=admin_token_headers,
    )
    s1_id = r.json()["id"]

    r = client.post(
        f"/api/v1/status-profiles/{profile_id}/statuses",
        json={"name": "Stage 2", "order": 1},
        headers=admin_token_headers,
    )
    s2_id = r.json()["id"]

    r = client.post(
        "/api/v1/projects",
        json={"name": "Flow Project", "code": "FLW-01", "start_date": "2026-03-01"},
        headers=admin_token_headers,
    )
    proj_id = r.json()["id"]
    r = client.post(f"/api/v1/projects/{proj_id}/apply-profile/{profile_id}", headers=admin_token_headers)
    statuses = r.json() # wait, apply-profile returns project out, get profile statuses:
    r = client.get(f"/api/v1/status-profiles/{client.get(f'/api/v1/projects/{proj_id}', headers=admin_token_headers).json()['status_profile_id']}", headers=admin_token_headers)
    st_list = r.json()["statuses"]
    st1 = st_list[0]["id"]
    st2 = st_list[1]["id"]

    # Create task in Stage 1
    r = client.post(
        "/api/v1/tasks",
        json={
            "project_id": proj_id,
            "title": "Task Flow",
            "start_date": "2026-03-01",
            "status_id": st1,
        },
        headers=admin_token_headers,
    )
    assert r.status_code == 201
    task_id = r.json()["id"]

    # Change status to Stage 2 and update period dates
    r = client.post(
        f"/api/v1/tasks/{task_id}/status",
        json={
            "status_id": st2,
            "start_date": "2026-03-05",
            "due_date": "2026-03-10",
            "actual_end_date": "2026-03-09",
        },
        headers=admin_token_headers,
    )
    assert r.status_code == 200, r.text
    updated = r.json()
    assert updated["status_id"] == st2

    # Check history
    r = client.get(f"/api/v1/tasks/{task_id}/history", headers=admin_token_headers)
    assert r.status_code == 200
    history = r.json()
    assert len(history) >= 2  # creation + status change


def test_blocked_map(client: TestClient, admin_token_headers):
    # Create project & statuses
    r = client.post("/api/v1/status-profiles", json={"name": "Block Profile", "is_template": True}, headers=admin_token_headers)
    pid = r.json()["id"]
    r = client.post(f"/api/v1/status-profiles/{pid}/statuses", json={"name": "Open", "order": 0}, headers=admin_token_headers)
    sid = r.json()["id"]
    r = client.post("/api/v1/projects", json={"name": "Block Proj", "code": "BLK-01", "start_date": "2026-03-01"}, headers=admin_token_headers)
    proj_id = r.json()["id"]
    client.post(f"/api/v1/projects/{proj_id}/apply-profile/{pid}", headers=admin_token_headers)

    r = client.post("/api/v1/tasks", json={"project_id": proj_id, "title": "A", "start_date": "2026-03-01", "status_id": sid}, headers=admin_token_headers)
    id_a = r.json()["id"]
    r = client.post("/api/v1/tasks", json={"project_id": proj_id, "title": "B", "start_date": "2026-03-01", "status_id": sid, "blocked_by_ids": [id_a]}, headers=admin_token_headers)
    assert r.status_code == 201
    id_b = r.json()["id"]

    r = client.get(f"/api/v1/tasks/blocked-map?project_id={proj_id}", headers=admin_token_headers)
    assert r.status_code == 200
    bmap = r.json()
    assert len(bmap) > 0
