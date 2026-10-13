"""02 Reminder recurrence plus overdue plus snooze seam tests.

Seams under test (spec .scratch/reminder + issue 02):
  1. Repeat none|daily|weekly|monthly|yearly with end never|after N|until
     date; Done/Dismiss chains the next occurrence from the due date
     (no drift), ended cadences just resolve.
  2. Overdue derives server-side (active + due reached + not snoozed);
     snooze 1d|1w suppresses it; date-only defaults to 09:00 server-local.
  3. Recurrence survives detach (03 interplay): detached items keep chaining.
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


def _setup(client: TestClient, admin_h, tag: str):
    cat = _make_category(client, admin_h, f"Rec Cat {tag}")
    r = client.post("/api/v1/status-profiles", json={"name": f"Rec Prof {tag}"}, headers=admin_h)
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
    proj = _make_project(client, admin_h, f"Rec Proj {tag}", f"RC-{tag[:2].upper()}1", cat["id"])
    return cat, proj


def _make_reminder(client: TestClient, h, payload: dict) -> dict:
    r = client.post("/api/v1/reminders", json=payload, headers=h)
    assert r.status_code == 201, r.text
    return r.json()


def _mine(client: TestClient, h) -> list:
    r = client.get("/api/v1/reminders/mine", headers=h)
    assert r.status_code == 200, r.text
    return r.json()


def test_daily_after_two_chains_once_then_ends(client: TestClient, admin_token_headers):
    h = admin_token_headers
    _, proj = _setup(client, h, "R1")
    task = _make_task(client, h, proj["id"], "Buy server")
    first = _make_reminder(
        client,
        h,
        {
            "title": "Check warranty",
            "due_at": "2030-01-10",
            "task_id": task["id"],
            "repeat": "daily",
            "repeat_end": "after",
            "repeat_after_n": 2,
        },
    )
    assert first["repeat"] == "daily"
    assert first["occurrence_index"] == 0

    r = client.post(f"/api/v1/reminders/{first['id']}/done", headers=h)
    assert r.status_code == 200, r.text
    active = _mine(client, h)
    assert len(active) == 1
    nxt = active[0]
    assert nxt["id"] != first["id"]
    assert nxt["due_at"] == "2030-01-11T09:00:00"
    assert nxt["occurrence_index"] == 1
    assert nxt["repeat"] == "daily"

    r = client.post(f"/api/v1/reminders/{nxt['id']}/done", headers=h)
    assert r.status_code == 200, r.text
    assert _mine(client, h) == []


def test_yearly_derives_from_due_date_without_drift(client: TestClient, admin_token_headers):
    h = admin_token_headers
    _, proj = _setup(client, h, "R2")
    first = _make_reminder(
        client,
        h,
        {
            "title": "Reinitiate tender",
            "due_at": "2030-05-15",
            "project_id": proj["id"],
            "repeat": "yearly",
        },
    )
    r = client.post(f"/api/v1/reminders/{first['id']}/done", headers=h)
    assert r.status_code == 200, r.text
    active = _mine(client, h)
    assert len(active) == 1
    assert active[0]["due_at"] == "2031-05-15T09:00:00"


def test_until_end_stops_chain(client: TestClient, admin_token_headers):
    h = admin_token_headers
    _, proj = _setup(client, h, "R3")
    first = _make_reminder(
        client,
        h,
        {
            "title": "Weekly check",
            "due_at": "2030-03-01",
            "project_id": proj["id"],
            "repeat": "weekly",
            "repeat_end": "until",
            "repeat_until": "2030-03-05",
        },
    )
    r = client.post(f"/api/v1/reminders/{first['id']}/dismiss", headers=h)
    assert r.status_code == 200, r.text
    assert _mine(client, h) == []


def test_recurrence_validation(client: TestClient, admin_token_headers):
    h = admin_token_headers
    _, proj = _setup(client, h, "R4")
    bad = [
        {"title": "x", "due_at": "2030-01-01", "project_id": proj["id"], "repeat": "hourly"},
        {
            "title": "x",
            "due_at": "2030-01-01",
            "project_id": proj["id"],
            "repeat": "daily",
            "repeat_end": "after",
        },
        {
            "title": "x",
            "due_at": "2030-01-01",
            "project_id": proj["id"],
            "repeat": "daily",
            "repeat_end": "after",
            "repeat_after_n": 0,
        },
        {
            "title": "x",
            "due_at": "2030-01-01",
            "project_id": proj["id"],
            "repeat": "daily",
            "repeat_end": "until",
        },
    ]
    for payload in bad:
        r = client.post("/api/v1/reminders", json=payload, headers=h)
        assert r.status_code == 422, (payload, r.text)


def test_date_only_defaults_to_0900_and_overdue_flags(client: TestClient, admin_token_headers):
    h = admin_token_headers
    _, proj = _setup(client, h, "R5")
    past = _make_reminder(
        client, h, {"title": "Past", "due_at": "2020-04-02", "project_id": proj["id"]}
    )
    assert past["due_at"] == "2020-04-02T09:00:00"
    assert past["is_overdue"] is True
    future = _make_reminder(
        client, h, {"title": "Future", "due_at": "2099-04-02", "project_id": proj["id"]}
    )
    assert future["is_overdue"] is False

    r = client.post(f"/api/v1/reminders/{past['id']}/snooze", json={"duration": "1d"}, headers=h)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["snoozed_until"]
    assert body["is_overdue"] is False

    r = client.post(f"/api/v1/reminders/{past['id']}/snooze", json={"duration": "1y"}, headers=h)
    assert r.status_code == 422, r.text


def test_detached_recurrence_keeps_chaining(client: TestClient, admin_token_headers):
    h = admin_token_headers
    _, proj = _setup(client, h, "R6")
    task = _make_task(client, h, proj["id"], "Buy server")
    first = _make_reminder(
        client,
        h,
        {
            "title": "Monthly audit",
            "due_at": "2030-06-15",
            "task_id": task["id"],
            "repeat": "monthly",
        },
    )
    r = client.delete(f"/api/v1/tasks/{task['id']}", headers=h)
    assert r.status_code == 200, r.text
    r = client.post(f"/api/v1/reminders/{first['id']}/done", headers=h)
    assert r.status_code == 200, r.text
    active = _mine(client, h)
    assert len(active) == 1
    nxt = active[0]
    assert nxt["due_at"] == "2030-07-15T09:00:00"
    assert nxt["task_id"] is None
    assert nxt["project_id"] is None
    assert "Buy server" in (nxt.get("ex_anchor_title") or "")
