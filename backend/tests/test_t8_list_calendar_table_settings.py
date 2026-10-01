"""T8 tests: List + Calendar + Table + Settings parity.

Seams under test:
  1. GET /api/v1/tasks honors SPEC-v0.2 4.5 aliases (status/assignee/watcher)
     plus overdue + combined depth/blocked/overdue/search filters.
  2. GET /api/v1/tasks/calendar?project_id= plots Task dues + Status Period
     planned dues, reuses same filters, view-gated (guest 403, non-member 404).
  3. GET /api/v1/tasks/table?project_id= returns Task + Status+dates + start +
     assignees + custom-field columns, reuses same filters, view-gated.
  4. Settings: member/guest cannot manage members or apply templates;
     manager/admin can; DELETE /projects/{id}/members/{user_id} works.
"""

from datetime import date, timedelta

from fastapi.testclient import TestClient


def _setup(client: TestClient, headers):
    r = client.post(
        "/api/v1/status-profiles",
        json={"name": "T8 Profile", "is_template": True},
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
    # custom field def on template -> copied to project on apply
    r = client.post(
        f"/api/v1/status-profiles/{profile_id}/custom-field-defs",
        json={"key": "vendor", "type": "text", "label": "Vendor", "order": 1},
        headers=headers,
    )
    assert r.status_code == 201, r.text

    r = client.post(
        "/api/v1/projects",
        json={"name": "T8 Project", "code": "T8P-01", "start_date": "2026-06-01"},
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


def test_list_filter_aliases_and_overdue(client: TestClient, admin_token_headers):
    h = admin_token_headers
    proj_id, statuses = _setup(client, h)
    todo_id, done_id = statuses["Todo"], statuses["Done"]
    member_id, _ = _mkuser(client, h, "t8member", "member")

    today = date.today()
    overdue_due = (today - timedelta(days=2)).isoformat()
    future_due = (today + timedelta(days=5)).isoformat()

    r = client.post(
        "/api/v1/tasks",
        json={
            "project_id": proj_id,
            "title": "Overdue apples",
            "start_date": "2026-06-01",
            "due_date": overdue_due,
            "status_id": todo_id,
            "assignee_ids": [member_id],
        },
        headers=h,
    )
    assert r.status_code == 201, r.text
    task_a = r.json()["id"]
    r = client.post(
        "/api/v1/tasks",
        json={
            "project_id": proj_id,
            "title": "Future oranges",
            "start_date": "2026-06-01",
            "due_date": future_due,
            "status_id": todo_id,
        },
        headers=h,
    )
    assert r.status_code == 201, r.text
    task_b = r.json()["id"]
    r = client.post(
        "/api/v1/tasks",
        json={
            "project_id": proj_id,
            "title": "Done old",
            "start_date": "2026-06-01",
            "due_date": overdue_due,
            "status_id": done_id,
        },
        headers=h,
    )
    assert r.status_code == 201, r.text

    # SPEC aliases: status / assignee / watcher
    r = client.get(f"/api/v1/tasks?project_id={proj_id}&status={todo_id}", headers=h)
    assert r.status_code == 200, r.text
    assert {t["id"] for t in r.json()} >= {task_a, task_b}
    r = client.get(f"/api/v1/tasks?project_id={proj_id}&status_id={todo_id}", headers=h)
    assert {t["id"] for t in r.json()} >= {task_a, task_b}

    r = client.get(f"/api/v1/tasks?project_id={proj_id}&assignee={member_id}", headers=h)
    assert r.status_code == 200, r.text
    assert [t["id"] for t in r.json()] == [task_a]
    r = client.get(f"/api/v1/tasks?project_id={proj_id}&assignee_id={member_id}", headers=h)
    assert [t["id"] for t in r.json()] == [task_a]

    # overdue=true returns only open past-due tasks
    r = client.get(f"/api/v1/tasks?project_id={proj_id}&overdue=true", headers=h)
    assert r.status_code == 200, r.text
    assert [t["id"] for t in r.json()] == [task_a]

    # combined filters: search + overdue + depth + blocked=false
    r = client.get(
        f"/api/v1/tasks?project_id={proj_id}&search=apples&overdue=true&depth=0&blocked=false",
        headers=h,
    )
    assert r.status_code == 200, r.text
    assert [t["id"] for t in r.json()] == [task_a]
    r = client.get(
        f"/api/v1/tasks?project_id={proj_id}&search=zzz-no-match&overdue=true",
        headers=h,
    )
    assert r.json() == []


def test_calendar_plots_task_and_period_dues(client: TestClient, admin_token_headers):
    h = admin_token_headers
    proj_id, statuses = _setup(client, h)
    todo_id = statuses["Todo"]
    member_id, member_h = _mkuser(client, h, "t8calmember", "member")
    guest_id, guest_h = _mkuser(client, h, "t8calguest", "guest")
    for uid, role in [(member_id, "member"), (guest_id, "guest")]:
        r = client.post(
            f"/api/v1/projects/{proj_id}/members",
            json={"user_id": uid, "role": role},
            headers=h,
        )
        assert r.status_code == 201, r.text

    today = date.today()
    task_due = (today + timedelta(days=4)).isoformat()
    period_due = (today + timedelta(days=6)).isoformat()
    r = client.post(
        "/api/v1/tasks",
        json={
            "project_id": proj_id,
            "title": "Cal task",
            "start_date": "2026-06-01",
            "due_date": task_due,
            "status_id": todo_id,
        },
        headers=h,
    )
    assert r.status_code == 201, r.text
    task_id = r.json()["id"]
    # second status period with its own planned due
    done_id = statuses["Done"]
    r = client.post(
        f"/api/v1/tasks/{task_id}/status",
        json={"status_id": done_id, "due_date": period_due},
        headers=h,
    )
    assert r.status_code == 200, r.text

    r = client.get(f"/api/v1/tasks/calendar?project_id={proj_id}", headers=member_h)
    assert r.status_code == 200, r.text
    events = r.json()
    kinds = {(e["task_id"], e["kind"], e["date"]) for e in events}
    assert (task_id, "task_due", task_due) in kinds
    assert any(k[0] == task_id and k[1] == "period_due" and k[2] == period_due for k in kinds)

    # same filters as list: search narrows, depth narrows
    r = client.get(f"/api/v1/tasks/calendar?project_id={proj_id}&search=Cal task", headers=member_h)
    assert r.status_code == 200 and len(r.json()) >= 1
    r = client.get(f"/api/v1/tasks/calendar?project_id={proj_id}&search=no-such-task", headers=member_h)
    assert r.json() == []

    # guest has no calendar view
    r = client.get(f"/api/v1/tasks/calendar?project_id={proj_id}", headers=guest_h)
    assert r.status_code == 403, r.text
    # outsider gets 404
    _, outsider_h = _mkuser(client, h, "t8caloutsider", "member")
    r = client.get(f"/api/v1/tasks/calendar?project_id={proj_id}", headers=outsider_h)
    assert r.status_code == 404, r.text


def test_table_returns_custom_field_columns(client: TestClient, admin_token_headers):
    h = admin_token_headers
    proj_id, statuses = _setup(client, h)
    todo_id = statuses["Todo"]
    member_id, member_h = _mkuser(client, h, "t8tabmember", "member")
    guest_id, guest_h = _mkuser(client, h, "t8tabguest", "guest")
    for uid, role in [(member_id, "member"), (guest_id, "guest")]:
        client.post(f"/api/v1/projects/{proj_id}/members", json={"user_id": uid, "role": role}, headers=h)

    r = client.post(
        "/api/v1/tasks",
        json={
            "project_id": proj_id,
            "title": "Table row",
            "start_date": "2026-06-02",
            "status_id": todo_id,
            "assignee_ids": [member_id],
        },
        headers=h,
    )
    assert r.status_code == 201, r.text
    task_id = r.json()["id"]

    defs = client.get(f"/api/v1/projects/{proj_id}/custom-field-defs", headers=h).json()
    assert any(d["key"] == "vendor" for d in defs)
    vendor_def = next(d for d in defs if d["key"] == "vendor")
    r = client.put(f"/api/v1/tasks/{task_id}/custom-fields", json={str(vendor_def["id"]): "Acme"}, headers=h)
    assert r.status_code == 200, r.text

    r = client.get(f"/api/v1/tasks/table?project_id={proj_id}", headers=member_h)
    assert r.status_code == 200, r.text
    body = r.json()
    assert any(d["key"] == "vendor" for d in body["defs"])
    rows = {row["id"]: row for row in body["rows"]}
    assert task_id in rows
    row = rows[task_id]
    assert row["title"] == "Table row"
    assert row["start_date"] == "2026-06-02"
    assert member_id in row["assignee_ids"]
    assert "status_id" in row
    assert row["custom_fields"].get("vendor") == "Acme"

    # filters shared with list
    r = client.get(f"/api/v1/tasks/table?project_id={proj_id}&search=Table row", headers=member_h)
    assert len(r.json()["rows"]) == 1
    r = client.get(f"/api/v1/tasks/table?project_id={proj_id}&search=nope", headers=member_h)
    assert r.json()["rows"] == []

    r = client.get(f"/api/v1/tasks/table?project_id={proj_id}", headers=guest_h)
    assert r.status_code == 403, r.text


def test_settings_members_gated_and_deletable(client: TestClient, admin_token_headers):
    h = admin_token_headers
    proj_id, _ = _setup(client, h)
    member_id, member_h = _mkuser(client, h, "t8setmember", "member")
    manager_id, manager_h = _mkuser(client, h, "t8setmanager", "manager")
    guest_id, guest_h = _mkuser(client, h, "t8setguest", "guest")
    for uid, role in [(member_id, "member"), (manager_id, "manager"), (guest_id, "guest")]:
        client.post(f"/api/v1/projects/{proj_id}/members", json={"user_id": uid, "role": role}, headers=h)

    # member/guest cannot add members or apply templates
    r = client.post(f"/api/v1/projects/{proj_id}/members", json={"user_id": member_id, "role": "member"}, headers=member_h)
    assert r.status_code == 403, r.text
    r = client.post(f"/api/v1/projects/{proj_id}/members", json={"user_id": member_id, "role": "member"}, headers=guest_h)
    assert r.status_code in (401, 403), r.text

    # manager can add + delete
    target_id, _ = _mkuser(client, h, "t8settarget", "member")
    r = client.post(f"/api/v1/projects/{proj_id}/members", json={"user_id": target_id, "role": "member"}, headers=manager_h)
    assert r.status_code == 201, r.text
    r = client.delete(f"/api/v1/projects/{proj_id}/members/{target_id}", headers=manager_h)
    assert r.status_code == 204, r.text
    r = client.get(f"/api/v1/projects/{proj_id}/members", headers=h)
    assert target_id not in {m["user_id"] for m in r.json()}

    # member cannot delete
    r = client.delete(f"/api/v1/projects/{proj_id}/members/{member_id}", headers=member_h)
    assert r.status_code == 403, r.text
