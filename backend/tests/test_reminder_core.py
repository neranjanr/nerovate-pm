"""01 Reminder anchored core (one-time) seam tests.

Seams under test (spec .scratch/reminder + issue 01):
  1. Reminder anchors to exactly one Project, Task, Subtask, or Microtask
     in any Status including Complete and Cancelled.
  2. My Reminders list plus anchor badge (filter by anchor) show the
     Reminder; Done and Dismiss both resolve it.
  3. Creation/editing follow the Task edit gate (member+ with project
     access; guest 403; outsider 404); visible to Assignee, Watchers,
     and Project Owners.
  4. CRUD + anchor-permission tests; existing suites stay green.
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
    cat = _make_category(client, admin_h, f"Rem Cat {tag}")
    # Tasks require a Status Profile on the parent Category (U4 defaults).
    r = client.post("/api/v1/status-profiles", json={"name": f"Rem Prof {tag}"}, headers=admin_h)
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
    proj = _make_project(client, admin_h, f"Rem Proj {tag}", f"RM-{tag[:2].upper()}1", cat["id"])
    return cat, proj


def test_anchor_exactly_one_project_or_task(client: TestClient, admin_token_headers):
    h = admin_token_headers
    _, proj = _setup(client, h, "A1")
    task = _make_task(client, h, proj["id"], "Buy server")

    # Project-anchored one-time reminder.
    r = client.post(
        "/api/v1/reminders",
        json={"title": "Reinitiate in 5y", "due_at": "2031-01-01", "project_id": proj["id"]},
        headers=h,
    )
    assert r.status_code == 201, r.text
    assert r.json()["project_id"] == proj["id"]
    assert r.json()["task_id"] is None
    assert r.json()["status"] == "active"

    # Task-anchored one-time reminder.
    r = client.post(
        "/api/v1/reminders",
        json={"title": "Follow up", "due_at": "2026-12-01", "task_id": task["id"]},
        headers=h,
    )
    assert r.status_code == 201, r.text
    assert r.json()["task_id"] == task["id"]

    # Neither anchor -> 422.
    r = client.post(
        "/api/v1/reminders", json={"title": "No anchor", "due_at": "2026-12-01"}, headers=h
    )
    assert r.status_code == 422, r.text

    # Both anchors -> 422 (exactly one).
    r = client.post(
        "/api/v1/reminders",
        json={
            "title": "Two anchors",
            "due_at": "2026-12-01",
            "project_id": proj["id"],
            "task_id": task["id"],
        },
        headers=h,
    )
    assert r.status_code == 422, r.text


def test_anchor_subtask_and_microtask_depths(client: TestClient, admin_token_headers):
    h = admin_token_headers
    _, proj = _setup(client, h, "A2")
    root = _make_task(client, h, proj["id"], "Root")
    sub = _make_task(client, h, proj["id"], "Sub 1.1", parent_id=root["id"])
    assert sub["depth"] == 1
    micro = _make_task(client, h, proj["id"], "Micro 1.1.1", parent_id=sub["id"])
    assert micro["depth"] == 2

    for anchor in (root, sub, micro):
        r = client.post(
            "/api/v1/reminders",
            json={"title": f"Ping {anchor['id']}", "due_at": "2027-01-01", "task_id": anchor["id"]},
            headers=h,
        )
        assert r.status_code == 201, r.text
        assert r.json()["task_id"] == anchor["id"]


def test_my_reminders_and_anchor_badge(client: TestClient, admin_token_headers):
    h = admin_token_headers
    _, proj = _setup(client, h, "A3")
    task = _make_task(client, h, proj["id"], "Buy server")
    r = client.post(
        "/api/v1/reminders",
        json={"title": "Reinitiate", "due_at": "2031-06-01", "task_id": task["id"]},
        headers=h,
    )
    assert r.status_code == 201, r.text
    rid = r.json()["id"]

    # My Reminders shows it.
    r = client.get("/api/v1/reminders/mine", headers=h)
    assert r.status_code == 200, r.text
    assert any(x["id"] == rid for x in r.json())

    # Anchor badge: filter by task anchor.
    r = client.get(f"/api/v1/reminders?task_id={task['id']}", headers=h)
    assert r.status_code == 200, r.text
    assert any(x["id"] == rid for x in r.json())

    # Anchor badge: filter by project (project-anchored only, not task-anchored).
    r = client.post(
        "/api/v1/reminders",
        json={"title": "Proj ping", "due_at": "2031-06-01", "project_id": proj["id"]},
        headers=h,
    )
    assert r.status_code == 201, r.text
    pid_rem = r.json()["id"]
    r = client.get(f"/api/v1/reminders?project_id={proj['id']}", headers=h)
    assert r.status_code == 200, r.text
    assert any(x["id"] == pid_rem for x in r.json())


def test_done_and_dismiss_both_resolve(client: TestClient, admin_token_headers):
    h = admin_token_headers
    _, proj = _setup(client, h, "A4")
    task = _make_task(client, h, proj["id"], "Buy server")

    r = client.post(
        "/api/v1/reminders",
        json={"title": "Done me", "due_at": "2026-11-01", "task_id": task["id"]},
        headers=h,
    )
    rid_done = r.json()["id"]
    r = client.post(f"/api/v1/reminders/{rid_done}/done", headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "done"

    r = client.post(
        "/api/v1/reminders",
        json={"title": "Dismiss me", "due_at": "2026-11-01", "task_id": task["id"]},
        headers=h,
    )
    rid_dis = r.json()["id"]
    r = client.post(f"/api/v1/reminders/{rid_dis}/dismiss", headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "dismissed"

    # Resolved items leave the default My Reminders (active-only) list.
    r = client.get("/api/v1/reminders/mine", headers=h)
    assert r.status_code == 200, r.text
    ids = [x["id"] for x in r.json()]
    assert rid_done not in ids
    assert rid_dis not in ids


def test_task_edit_gate_guest_403_outsider_404(client: TestClient, admin_token_headers):
    h = admin_token_headers
    _, proj = _setup(client, h, "A5")
    task = _make_task(client, h, proj["id"], "Buy server")

    outsider = _make_user(client, h, "rem_outsider", "member")
    assert outsider["id"]
    oh = _login(client, "rem_outsider")
    guest_u = _make_user(client, h, "rem_guest", "guest")
    assert guest_u["id"]
    # Give guest project visibility so the gate hits the writer check (403 not 404).
    r = client.post(
        f"/api/v1/projects/{proj['id']}/members",
        json={"user_id": guest_u["id"], "role": "guest"},
        headers=h,
    )
    assert r.status_code == 201, r.text
    gh = _login(client, "rem_guest")

    # Guest with project access -> 403 (Task edit gate: guest read-only).
    r = client.post(
        "/api/v1/reminders",
        json={"title": "Guest try", "due_at": "2026-12-01", "task_id": task["id"]},
        headers=gh,
    )
    assert r.status_code == 403, r.text

    # Outsider with no membership -> 404 (no enumeration, like tasks).
    r = client.post(
        "/api/v1/reminders",
        json={"title": "Outsider try", "due_at": "2026-12-01", "task_id": task["id"]},
        headers=oh,
    )
    assert r.status_code == 404, r.text

    # Admin-created reminder is invisible to outsider (404 on read).
    r = client.post(
        "/api/v1/reminders",
        json={"title": "Hidden", "due_at": "2026-12-01", "task_id": task["id"]},
        headers=h,
    )
    rid = r.json()["id"]
    r = client.get(f"/api/v1/reminders/{rid}", headers=oh)
    assert r.status_code == 404, r.text


def test_visible_to_assignee_watcher_and_owner(client: TestClient, admin_token_headers):
    h = admin_token_headers
    cat, proj = _setup(client, h, "A6")
    # Owner of the project is admin (creator). Make a non-member assignee.
    watcher = _make_user(client, h, "rem_watcher", "member")
    assignee = _make_user(client, h, "rem_assignee", "member")
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
        json={"title": "Assignee ping", "due_at": "2026-12-01", "task_id": task["id"]},
        headers=h,
    )
    assert r.status_code == 201, r.text
    rid = r.json()["id"]

    for username in ("rem_assignee", "rem_watcher"):
        uh = _login(client, username)
        r = client.get(f"/api/v1/reminders/{rid}", headers=uh)
        assert r.status_code == 200, r.text
        r = client.get("/api/v1/reminders/mine", headers=uh)
        assert r.status_code == 200, r.text
        assert any(x["id"] == rid for x in r.json()), username

    # Project-anchored reminder visible to a direct project member (owner path).
    member = _make_user(client, h, "rem_member", "member")
    r = client.post(
        f"/api/v1/projects/{proj['id']}/members",
        json={"user_id": member["id"], "role": "member"},
        headers=h,
    )
    assert r.status_code == 201, r.text
    mh = _login(client, "rem_member")
    r = client.post(
        "/api/v1/reminders",
        json={"title": "Proj ping", "due_at": "2026-12-01", "project_id": proj["id"]},
        headers=h,
    )
    pid_rem = r.json()["id"]
    r = client.get(f"/api/v1/reminders/{pid_rem}", headers=mh)
    assert r.status_code == 200, r.text


def test_crud_patch_and_delete(client: TestClient, admin_token_headers):
    h = admin_token_headers
    _, proj = _setup(client, h, "A7")
    task = _make_task(client, h, proj["id"], "Buy server")
    r = client.post(
        "/api/v1/reminders",
        json={"title": "Original", "due_at": "2026-12-01", "task_id": task["id"]},
        headers=h,
    )
    assert r.status_code == 201, r.text
    rid = r.json()["id"]

    r = client.patch(
        f"/api/v1/reminders/{rid}", json={"title": "Renamed", "due_at": "2027-01-15"}, headers=h
    )
    assert r.status_code == 200, r.text
    assert r.json()["title"] == "Renamed"

    # Blank title rejected like tasks.
    r = client.patch(f"/api/v1/reminders/{rid}", json={"title": "   "}, headers=h)
    assert r.status_code == 422, r.text

    r = client.delete(f"/api/v1/reminders/{rid}", headers=h)
    assert r.status_code in (200, 204), r.text
    r = client.get(f"/api/v1/reminders/{rid}", headers=h)
    assert r.status_code == 404, r.text
