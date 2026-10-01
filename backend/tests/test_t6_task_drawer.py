"""T6 tests: Task Drawer API (Comments, Attachments, Custom Fields, Subtasks, Watchers).

Seams under test:
  1. GET/POST /api/v1/tasks/{id}/comments
  2. GET/POST/DELETE /api/v1/tasks/{id}/attachments
  3. GET/PUT /api/v1/tasks/{id}/custom-fields
  4. GET /api/v1/tasks/{id}/subtasks and depth capping (0 > 1.1 > 1.1.1)
  5. Updating assignees, watchers, blocked-by via task update
"""

import io
from fastapi.testclient import TestClient


def test_task_drawer_features(client: TestClient, admin_token_headers):
    # Setup status profile & statuses
    r = client.post(
        "/api/v1/status-profiles",
        json={"name": "Drawer Profile", "is_template": True},
        headers=admin_token_headers,
    )
    assert r.status_code == 201
    profile_id = r.json()["id"]

    r = client.post(
        f"/api/v1/status-profiles/{profile_id}/statuses",
        json={"name": "To Do", "order": 1},
        headers=admin_token_headers,
    )
    status_id = r.json()["id"]

    # Add a custom field def
    r = client.post(
        f"/api/v1/status-profiles/{profile_id}/custom-field-defs",
        json={"key": "vendor", "type": "text", "label": "Vendor", "required": False, "order": 1},
        headers=admin_token_headers,
    )
    assert r.status_code == 201

    # Setup project
    r = client.post(
        "/api/v1/projects",
        json={"name": "Drawer Project", "code": "DRW-01", "start_date": "2026-04-01"},
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
    sid = statuses[0]["id"]

    # Create Task (Depth 0)
    r = client.post(
        "/api/v1/tasks",
        json={
            "project_id": proj_id,
            "title": "Root Task",
            "start_date": "2026-04-01",
            "status_id": sid,
            "priority": "high",
        },
        headers=admin_token_headers,
    )
    assert r.status_code == 201
    task_id = r.json()["id"]

    # 1. Comments
    r = client.post(
        f"/api/v1/tasks/{task_id}/comments",
        json={"body_md": "This is a **markdown** comment mentioning someone."},
        headers=admin_token_headers,
    )
    assert r.status_code == 201
    comment_data = r.json()
    assert comment_data["body_md"] == "This is a **markdown** comment mentioning someone."

    r = client.get(f"/api/v1/tasks/{task_id}/comments", headers=admin_token_headers)
    assert r.status_code == 200
    assert len(r.json()) == 1
    parent_comment_id = comment_data["id"]

    # Threaded reply + mentions
    r = client.get("/api/v1/users", headers=admin_token_headers)
    assert r.status_code == 200
    admin_id = [u["id"] for u in r.json() if u["username"] == "admin"][0]
    r = client.post(
        f"/api/v1/tasks/{task_id}/comments",
        json={"body_md": "Reply with @admin mention", "parent_id": parent_comment_id, "mentions": [admin_id]},
        headers=admin_token_headers,
    )
    assert r.status_code == 201
    assert r.json()["parent_id"] == parent_comment_id
    assert admin_id in r.json()["mentions"]

    r = client.get(f"/api/v1/tasks/{task_id}/comments", headers=admin_token_headers)
    assert r.status_code == 200
    assert len(r.json()) == 2

    # Invalid parent comment rejected
    r = client.post(
        f"/api/v1/tasks/{task_id}/comments",
        json={"body_md": "bad parent", "parent_id": 999999},
        headers=admin_token_headers,
    )
    assert r.status_code == 400

    # 2. Attachments
    file_content = b"fake pdf or image content"
    r = client.post(
        f"/api/v1/tasks/{task_id}/attachments",
        files={"file": ("spec.pdf", io.BytesIO(file_content), "application/pdf")},
        headers=admin_token_headers,
    )
    assert r.status_code == 201
    att_data = r.json()
    assert att_data["filename"] == "spec.pdf"
    att_id = att_data["id"]

    r = client.get(f"/api/v1/tasks/{task_id}/attachments", headers=admin_token_headers)
    assert r.status_code == 200
    assert len(r.json()) == 1

    r = client.delete(f"/api/v1/tasks/{task_id}/attachments/{att_id}", headers=admin_token_headers)
    assert r.status_code == 204

    # 3. Custom Fields
    r = client.get(f"/api/v1/tasks/{task_id}/custom-fields", headers=admin_token_headers)
    assert r.status_code == 200
    cf_defs = r.json()
    assert len(cf_defs) >= 1
    def_id = cf_defs[0]["def_id"]

    r = client.put(
        f"/api/v1/tasks/{task_id}/custom-fields",
        json={str(def_id): "Acme Corp"},
        headers=admin_token_headers,
    )
    assert r.status_code == 200
    assert r.json()[0]["value"] == "Acme Corp"

    # 4. Hierarchy / Subtasks (0 -> 1.1 -> 1.1.1)
    r = client.post(
        "/api/v1/tasks",
        json={
            "project_id": proj_id,
            "parent_id": task_id,
            "title": "Subtask 1.1",
            "start_date": "2026-04-02",
            "status_id": sid,
        },
        headers=admin_token_headers,
    )
    assert r.status_code == 201
    sub_id = r.json()["id"]
    assert r.json()["depth"] == 1

    r = client.get(f"/api/v1/tasks/{task_id}/subtasks", headers=admin_token_headers)
    assert r.status_code == 200
    assert len(r.json()) == 1

    # Microtask 1.1.1 (depth 2)
    r = client.post(
        "/api/v1/tasks",
        json={
            "project_id": proj_id,
            "parent_id": sub_id,
            "title": "Microtask 1.1.1",
            "start_date": "2026-04-03",
            "status_id": sid,
        },
        headers=admin_token_headers,
    )
    assert r.status_code == 201
    micro_id = r.json()["id"]
    assert r.json()["depth"] == 2

    # Try depth 3 -> should fail (capped at 2)
    r = client.post(
        "/api/v1/tasks",
        json={
            "project_id": proj_id,
            "parent_id": micro_id,
            "title": "Too deep",
            "start_date": "2026-04-04",
            "status_id": sid,
        },
        headers=admin_token_headers,
    )
    assert r.status_code == 400

    # 5. Relations: assignees/watchers/blocked-by via PUT, self-block rejected
    r = client.put(
        f"/api/v1/tasks/{task_id}",
        json={"blocked_by_ids": [task_id]},
        headers=admin_token_headers,
    )
    assert r.status_code == 400

    r = client.put(
        f"/api/v1/tasks/{task_id}",
        json={"blocked_by_ids": [sub_id]},
        headers=admin_token_headers,
    )
    assert r.status_code == 200
    assert sub_id in r.json()["blocked_by_ids"]
