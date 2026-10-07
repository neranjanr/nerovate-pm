"""U4 seam tests: Title-only Tasks + defaults.

Seams under test (SPEC-v0.3 4.4 + ticket U4):
  1. POST /tasks requires title only; defaults status_id=first leaf of
     first Stage, start_date=creation date. No 422 on missing fields.
  2. Same defaults apply to Subtask (depth 1) + Microtask (depth 2).
  3. Depth 0/1/2 kept, same-Project parent only, depth 3+ rejected.
  4. blocked_by stays same-Project only.
"""

from datetime import date

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


def _staged_profile(client: TestClient, headers, name: str = "U4 Prof") -> tuple[int, list[dict], list[dict]]:
    r = client.post("/api/v1/status-profiles", json={"name": name}, headers=headers)
    assert r.status_code == 201, r.text
    pid = r.json()["id"]
    stage_ids: list[dict] = []
    for sname in ("First Stage", "Second Stage"):
        r = client.post(
            f"/api/v1/status-profiles/{pid}/stages",
            json={"name": sname},
            headers=headers,
        )
        assert r.status_code == 201, r.text
        stage_ids.append(r.json())
    statuses: list[dict] = []
    for i, sname in enumerate(("Alpha", "Beta")):
        r = client.post(
            f"/api/v1/status-profiles/{pid}/statuses",
            json={"name": sname, "stage_id": stage_ids[0]["id"]},
            headers=headers,
        )
        assert r.status_code == 201, r.text
        statuses.append(r.json())
    r = client.post(
        f"/api/v1/status-profiles/{pid}/statuses",
        json={"name": "Gamma", "stage_id": stage_ids[1]["id"]},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    statuses.append(r.json())
    return pid, stage_ids, statuses


def _setup_project_with_profile(client: TestClient, headers, tag: str):
    pid, stages, statuses = _staged_profile(client, headers, f"U4 Prof {tag}")
    cat = _make_category(client, headers, f"U4 Cat {tag}")
    r = client.patch(
        f"/api/v1/categories/{cat['id']}",
        json={"status_profile_id": pid},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    proj = _make_project(client, headers, f"U4 Proj {tag}", f"U4-{tag[:2].upper()}1", cat["id"])
    return proj, pid, stages, statuses


def test_title_only_create_defaults(client: TestClient, admin_token_headers):
    h = admin_token_headers
    proj, pid, stages, statuses = _setup_project_with_profile(client, h, "T1")
    today = date.today().isoformat()

    r = client.post(
        "/api/v1/tasks",
        json={"project_id": proj["id"], "title": "Title only"},
        headers=h,
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["title"] == "Title only"
    assert body["depth"] == 0
    # First leaf of first Stage = Alpha (first status in First Stage).
    assert body["status_id"] == statuses[0]["id"]
    assert body["start_date"] == today
    assert len(body["status_periods"]) >= 1
    assert body["status_periods"][0]["status_id"] == statuses[0]["id"]


def test_title_only_subtask_microtask_chain(client: TestClient, admin_token_headers):
    h = admin_token_headers
    proj, pid, stages, statuses = _setup_project_with_profile(client, h, "T2")
    today = date.today().isoformat()

    r = client.post(
        "/api/v1/tasks", json={"project_id": proj["id"], "title": "Root"}, headers=h
    )
    assert r.status_code == 201, r.text
    root = r.json()
    assert root["start_date"] == today

    r = client.post(
        "/api/v1/tasks",
        json={"project_id": proj["id"], "parent_id": root["id"], "title": "Sub 1.1"},
        headers=h,
    )
    assert r.status_code == 201, r.text
    sub = r.json()
    assert sub["depth"] == 1
    assert sub["parent_id"] == root["id"]
    assert sub["status_id"] == statuses[0]["id"]

    r = client.post(
        "/api/v1/tasks",
        json={"project_id": proj["id"], "parent_id": sub["id"], "title": "Micro 1.1.1"},
        headers=h,
    )
    assert r.status_code == 201, r.text
    micro = r.json()
    assert micro["depth"] == 2
    assert micro["status_id"] == statuses[0]["id"]

    # Depth 3 rejected.
    r = client.post(
        "/api/v1/tasks",
        json={"project_id": proj["id"], "parent_id": micro["id"], "title": "Too deep"},
        headers=h,
    )
    assert r.status_code in (400, 422)


def test_explicit_fields_still_win(client: TestClient, admin_token_headers):
    h = admin_token_headers
    proj, pid, stages, statuses = _setup_project_with_profile(client, h, "T3")
    r = client.post(
        "/api/v1/tasks",
        json={
            "project_id": proj["id"],
            "title": "Explicit",
            "status_id": statuses[2]["id"],
            "start_date": "2026-02-02",
        },
        headers=h,
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["status_id"] == statuses[2]["id"]
    assert body["start_date"] == "2026-02-02"


def test_blank_title_rejected_and_cross_project_parent_rejected(
    client: TestClient, admin_token_headers
):
    h = admin_token_headers
    proj, _, _, _ = _setup_project_with_profile(client, h, "T4")
    other, _, _, _ = _setup_project_with_profile(client, h, "T5")

    r = client.post(
        "/api/v1/tasks", json={"project_id": proj["id"], "title": "   "}, headers=h
    )
    assert r.status_code == 422

    r = client.post(
        "/api/v1/tasks", json={"project_id": proj["id"], "title": "Other root"}, headers=h
    )
    assert r.status_code == 201, r.text
    other_root = r.json()

    # Same-Project parent only: parent from another project must fail.
    r = client.post(
        "/api/v1/tasks",
        json={"project_id": other["id"], "parent_id": other_root["id"], "title": "X"},
        headers=h,
    )
    assert r.status_code == 400


def test_blocked_by_same_project_only(client: TestClient, admin_token_headers):
    h = admin_token_headers
    proj, _, _, _ = _setup_project_with_profile(client, h, "T6")
    other, _, _, _ = _setup_project_with_profile(client, h, "T7")

    r = client.post(
        "/api/v1/tasks", json={"project_id": other["id"], "title": " blocker"}, headers=h
    )
    assert r.status_code == 201, r.text
    foreign = r.json()

    r = client.post(
        "/api/v1/tasks",
        json={"project_id": proj["id"], "title": "Needs", "blocked_by_ids": [foreign["id"]]},
        headers=h,
    )
    assert r.status_code == 400
    # Rejected create must not leave an orphan Task behind.
    r = client.get(f"/api/v1/tasks?project_id={proj['id']}&search=Needs", headers=h)
    assert r.status_code == 200, r.text
    assert all(t["title"] != "Needs" for t in r.json())
