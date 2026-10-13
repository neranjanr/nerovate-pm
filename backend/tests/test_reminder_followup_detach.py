"""03 Reminder follow-up plus detach-on-delete seam tests.

Seams under test (spec .scratch/reminder + issue 03):
  1. Firing notifies Assignee, Watchers, Project Owners; offers one-click
     follow-up (no auto-create).
  2. Follow-up creates a Project pre-linked continues-as; Reminder stays on
     the original anchor (never migrates).
  3. Deleting anchored Project/Task/Subtask/Microtask detaches Reminders to
     standalone keeping ex-anchor title; delete never blocked, never cascades.
  4. Detached items keep working (done/dismiss/mine).
"""

from fastapi.testclient import TestClient


def _make_category(client: TestClient, headers, name: str) -> dict:
    r = client.post("/api/v1/categories", json={"name": name}, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


def _make_project(client: TestClient, headers, name: str, code: str, category_id: int) -> dict:
    r = client.post(
        "/api/v1/projects",
        json={"name": name, "code": code, "category_id": category_id},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()


def _make_task(client: TestClient, headers, project_id: int, title: str, **kw) -> dict:
    payload = {"project_id": project_id, "title": title}
    payload.update(kw)
    r = client.post("/api/v1/tasks", json=payload, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


def _make_user(client: TestClient, admin_h, username: str, role: str) -> dict:
    r = client.post(
        "/api/v1/users",
        json={"username": username, "password": "pass12345", "name": username, "role": role},
        headers=admin_h,
    )
    assert r.status_code == 201, r.text
    return r.json()


def _login(client: TestClient, username: str) -> dict:
    r = client.post("/api/v1/auth/login", json={"username": username, "password": "pass12345"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _setup(client: TestClient, admin_h, tag: str):
    cat = _make_category(client, admin_h, f"Fup Cat {tag}")
    r = client.post("/api/v1/status-profiles", json={"name": f"Fup Prof {tag}"}, headers=admin_h)
    assert r.status_code == 201, r.text
    pid = r.json()["id"]
    r = client.post(
        f"/api/v1/status-profiles/{pid}/stages", json={"name": "Stage One"}, headers=admin_h
    )
    assert r.status_code == 201, r.text
    stage_id = r.json()["id"]
    for sname in ("Open", "Closed"):
        r = client.post(
            f"/api/v1/status-profiles/{pid}/statuses",
            json={"name": f"{sname} {tag}", "stage_id": stage_id},
            headers=admin_h,
        )
        assert r.status_code == 201, r.text
    r = client.patch(
        f"/api/v1/categories/{cat['id']}", json={"status_profile_id": pid}, headers=admin_h
    )
    assert r.status_code == 200, r.text
    proj = _make_project(client, admin_h, f"Fup Proj {tag}", f"FU-{tag[:2].upper()}1", cat["id"])
    return cat, proj


def test_fire_notifies_and_offers_followup_without_autocreate(
    client: TestClient, admin_token_headers
):
    h = admin_token_headers
    _, proj = _setup(client, h, "F1")
    assignee = _make_user(client, h, "fup_assignee", "member")
    watcher = _make_user(client, h, "fup_watcher", "member")
    task = _make_task(
        client,
        h,
        proj["id"],
        "Buy server",
        assignee_ids=[assignee["id"]],
        watcher_ids=[watcher["id"]],
    )
    r = client.post(
        "/api/v1/reminders",
        json={"title": "Reinitiate", "due_at": "2026-01-01", "task_id": task["id"]},
        headers=h,
    )
    assert r.status_code == 201, r.text
    rid = r.json()["id"]

    r = client.post(f"/api/v1/reminders/{rid}/fire", headers=h)
    assert r.status_code == 200, r.text
    body = r.json()
    notify = set(body.get("notify_user_ids", []))
    # Assignee + Watcher + Project Owner (admin creator) all notified.
    assert assignee["id"] in notify
    assert watcher["id"] in notify
    assert body["reminder"]["id"] == rid
    # One-click offer, no auto-create: no new project exists yet.
    follow = body.get("follow_up", {})
    assert follow.get("kind") == "continues-as"
    assert follow.get("source_project_id") == proj["id"]
    r = client.get("/api/v1/projects", headers=h)
    assert r.status_code == 200, r.text
    assert len(r.json()) == 1


def test_followup_creates_linked_project_and_reminder_stays(
    client: TestClient, admin_token_headers
):
    h = admin_token_headers
    cat, proj = _setup(client, h, "F2")
    task = _make_task(client, h, proj["id"], "Buy server")
    r = client.post(
        "/api/v1/reminders",
        json={"title": "Reinitiate", "due_at": "2031-01-01", "task_id": task["id"]},
        headers=h,
    )
    assert r.status_code == 201, r.text
    rid = r.json()["id"]

    r = client.post(
        f"/api/v1/reminders/{rid}/follow-up-project",
        json={"name": "Buy server replacement", "code": "SRV-R2", "category_id": cat["id"]},
        headers=h,
    )
    assert r.status_code == 201, r.text
    body = r.json()
    new_proj = body["project"]
    link = body["link"]
    assert link["kind"] == "continues-as"
    assert link["from_project_id"] == proj["id"]
    assert link["to_project_id"] == new_proj["id"]
    # Reminder never migrates: still anchored to the original task.
    assert body["reminder"]["id"] == rid
    assert body["reminder"]["task_id"] == task["id"]
    r = client.get(f"/api/v1/reminders/{rid}", headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["task_id"] == task["id"]


def test_delete_task_detaches_not_cascades(client: TestClient, admin_token_headers):
    h = admin_token_headers
    _, proj = _setup(client, h, "F3")
    task = _make_task(client, h, proj["id"], "Buy server")
    r = client.post(
        "/api/v1/reminders",
        json={"title": "Reinitiate", "due_at": "2031-01-01", "task_id": task["id"]},
        headers=h,
    )
    assert r.status_code == 201, r.text
    rid = r.json()["id"]

    r = client.delete(f"/api/v1/tasks/{task['id']}", headers=h)
    assert r.status_code == 200, r.text

    # Reminder survives as standalone with ex-anchor title; delete not blocked.
    r = client.get(f"/api/v1/reminders/{rid}", headers=h)
    assert r.status_code == 200, r.text
    detached = r.json()
    assert detached["task_id"] is None
    assert detached["project_id"] is None
    assert "Buy server" in (detached.get("ex_anchor_title") or "")
    # Still actionable after detach (recurrence seam keeps working).
    r = client.post(f"/api/v1/reminders/{rid}/done", headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "done"


def test_delete_subtask_and_microtask_detach(client: TestClient, admin_token_headers):
    h = admin_token_headers
    _, proj = _setup(client, h, "F4")
    root = _make_task(client, h, proj["id"], "Root")
    sub = _make_task(client, h, proj["id"], "Sub 1.1", parent_id=root["id"])
    micro = _make_task(client, h, proj["id"], "Micro 1.1.1", parent_id=sub["id"])
    r = client.post(
        "/api/v1/reminders",
        json={"title": "Micro ping", "due_at": "2031-01-01", "task_id": micro["id"]},
        headers=h,
    )
    assert r.status_code == 201, r.text
    rid = r.json()["id"]

    r = client.delete(f"/api/v1/tasks/{micro['id']}", headers=h)
    assert r.status_code == 200, r.text
    r = client.get(f"/api/v1/reminders/{rid}", headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["task_id"] is None
    assert "Micro 1.1.1" in (r.json().get("ex_anchor_title") or "")


def test_delete_project_detaches_and_never_blocks(client: TestClient, admin_token_headers):
    h = admin_token_headers
    _, proj = _setup(client, h, "F5")
    task = _make_task(client, h, proj["id"], "Buy server")
    r = client.post(
        "/api/v1/reminders",
        json={"title": "Proj ping", "due_at": "2031-01-01", "project_id": proj["id"]},
        headers=h,
    )
    assert r.status_code == 201, r.text
    rid_proj = r.json()["id"]
    r = client.post(
        "/api/v1/reminders",
        json={"title": "Task ping", "due_at": "2031-01-01", "task_id": task["id"]},
        headers=h,
    )
    assert r.status_code == 201, r.text
    rid_task = r.json()["id"]

    r = client.delete(f"/api/v1/projects/{proj['id']}", headers=h)
    assert r.status_code in (200, 204), r.text

    for rid, needle in ((rid_proj, proj["name"]), (rid_task, "Buy server")):
        r = client.get(f"/api/v1/reminders/{rid}", headers=h)
        assert r.status_code == 200, r.text
        assert r.json()["task_id"] is None
        assert r.json()["project_id"] is None
        assert needle in (r.json().get("ex_anchor_title") or "")
