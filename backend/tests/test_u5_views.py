"""U5 seam tests: Tiered Board + Timeline.

Seams under test (SPEC-v0.3 4.5 + ticket U5):
  1. GET /tasks gains category_id + stage_id filters (depth 0/1/2 kept).
  2. GET /tasks/timeline gains stage_id filter; periods source unchanged.
  3. GET /tasks/blocked-map gains stage_id filter.
  4. GET /dashboard/summary gains stage_id filter + by_stage breakdown
     (counts + % done per Stage for Board headers / Timeline pipeline).
  5. Drag-drop across Stages (POST /tasks/{id}/status) writes history + period.
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


def _staged_setup(client: TestClient, headers, tag: str):
    r = client.post("/api/v1/status-profiles", json={"name": f"U5 Prof {tag}"}, headers=headers)
    assert r.status_code == 201, r.text
    pid = r.json()["id"]
    stage_ids: list[dict] = []
    for sname in ("Stage A", "Stage B"):
        r = client.post(
            f"/api/v1/status-profiles/{pid}/stages", json={"name": sname}, headers=headers
        )
        assert r.status_code == 201, r.text
        stage_ids.append(r.json())
    statuses: list[dict] = []
    for sname in ("A1", "A2"):
        r = client.post(
            f"/api/v1/status-profiles/{pid}/statuses",
            json={"name": sname, "stage_id": stage_ids[0]["id"]},
            headers=headers,
        )
        assert r.status_code == 201, r.text
        statuses.append(r.json())
    r = client.post(
        f"/api/v1/status-profiles/{pid}/statuses",
        json={"name": "B1", "stage_id": stage_ids[1]["id"], "is_done": True},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    statuses.append(r.json())
    cat = _make_category(client, headers, f"U5 Cat {tag}")
    r = client.patch(
        f"/api/v1/categories/{cat['id']}", json={"status_profile_id": pid}, headers=headers
    )
    assert r.status_code == 200, r.text
    proj = _make_project(client, headers, f"U5 Proj {tag}", f"U5-{tag[:2].upper()}1", cat["id"])
    return cat, proj, pid, stage_ids, statuses


def _make_task(client: TestClient, headers, project_id: int, status_id: int, title: str) -> dict:
    r = client.post(
        "/api/v1/tasks",
        json={"project_id": project_id, "title": title, "status_id": status_id,
              "start_date": "2026-01-01"},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()


def test_tasks_filter_by_stage_id(client: TestClient, admin_token_headers):
    h = admin_token_headers
    _, proj, _, stages, statuses = _staged_setup(client, h, "F1")
    _make_task(client, h, proj["id"], statuses[0]["id"], "In A1")
    _make_task(client, h, proj["id"], statuses[2]["id"], "In B1")

    r = client.get(f"/api/v1/tasks?project_id={proj['id']}&stage_id={stages[0]['id']}", headers=h)
    assert r.status_code == 200, r.text
    rows = r.json()
    assert len(rows) == 1
    assert rows[0]["title"] == "In A1"

    r = client.get(f"/api/v1/tasks?project_id={proj['id']}&stage_id={stages[1]['id']}", headers=h)
    assert r.status_code == 200, r.text
    assert len(r.json()) == 1


def test_tasks_filter_by_category_id(client: TestClient, admin_token_headers):
    h = admin_token_headers
    cat1, proj1, _, _, st1 = _staged_setup(client, h, "C1")
    cat2, proj2, _, _, st2 = _staged_setup(client, h, "C2")
    _make_task(client, h, proj1["id"], st1[0]["id"], "Cat1 task")
    _make_task(client, h, proj2["id"], st2[0]["id"], "Cat2 task")

    r = client.get(f"/api/v1/tasks?category_id={cat1['id']}", headers=h)
    assert r.status_code == 200, r.text
    titles = [t["title"] for t in r.json()]
    assert "Cat1 task" in titles
    assert "Cat2 task" not in titles


def test_tasks_stage_depth_combo(client: TestClient, admin_token_headers):
    h = admin_token_headers
    _, proj, _, stages, statuses = _staged_setup(client, h, "SD")
    root = _make_task(client, h, proj["id"], statuses[0]["id"], "Root A")
    r = client.post(
        "/api/v1/tasks",
        json={"project_id": proj["id"], "parent_id": root["id"], "title": "Sub A",
              "status_id": statuses[0]["id"]},
        headers=h,
    )
    assert r.status_code == 201, r.text
    r = client.get(
        f"/api/v1/tasks?project_id={proj['id']}&stage_id={stages[0]['id']}&depth=1", headers=h
    )
    assert r.status_code == 200, r.text
    assert len(r.json()) == 1
    assert r.json()[0]["title"] == "Sub A"


def test_timeline_stage_filter_and_periods(client: TestClient, admin_token_headers):
    h = admin_token_headers
    _, proj, _, stages, statuses = _staged_setup(client, h, "TL")
    t = _make_task(client, h, proj["id"], statuses[0]["id"], "TL task")
    r = client.post(
        f"/api/v1/tasks/{t['id']}/status",
        json={"status_id": statuses[2]["id"], "start_date": "2026-02-01",
              "due_date": "2026-02-10"},
        headers=h,
    )
    assert r.status_code == 200, r.text

    r = client.get(f"/api/v1/tasks/timeline?project_id={proj['id']}", headers=h)
    assert r.status_code == 200, r.text
    assert len(r.json()) >= 1
    item = next(i for i in r.json() if i["task_id"] == t["id"])
    # Stacked bars source: periods cover both the original and the new status.
    period_statuses = {p["status_id"] for p in item["periods"]}
    assert statuses[0]["id"] in period_statuses
    assert statuses[2]["id"] in period_statuses

    r = client.get(
        f"/api/v1/tasks/timeline?project_id={proj['id']}&stage_id={stages[1]['id']}", headers=h
    )
    assert r.status_code == 200, r.text
    assert any(i["task_id"] == t["id"] for i in r.json())

    r = client.get(
        f"/api/v1/tasks/timeline?project_id={proj['id']}&stage_id={stages[0]['id']}", headers=h
    )
    assert r.status_code == 200, r.text
    # Task now lives in Stage B, so Stage A filter excludes it.
    assert all(i["task_id"] != t["id"] for i in r.json())


def test_blocked_map_stage_filter(client: TestClient, admin_token_headers):
    h = admin_token_headers
    _, proj, _, stages, statuses = _staged_setup(client, h, "BM")
    a = _make_task(client, h, proj["id"], statuses[0]["id"], "BM A")
    r = client.post(
        "/api/v1/tasks",
        json={"project_id": proj["id"], "title": "BM B", "status_id": statuses[2]["id"],
              "blocked_by_ids": [a["id"]]},
        headers=h,
    )
    assert r.status_code == 201, r.text
    r = client.get(
        f"/api/v1/tasks/blocked-map?project_id={proj['id']}&stage_id={stages[1]['id']}", headers=h
    )
    assert r.status_code == 200, r.text
    assert any(row["title"] == "BM B" for row in r.json())
    assert all(row["title"] != "BM A" for row in r.json())


def test_dashboard_summary_stage_breakdown(client: TestClient, admin_token_headers):
    h = admin_token_headers
    _, proj, _, stages, statuses = _staged_setup(client, h, "DB")
    _make_task(client, h, proj["id"], statuses[0]["id"], "DB A")
    _make_task(client, h, proj["id"], statuses[2]["id"], "DB B done")

    r = client.get(f"/api/v1/dashboard/summary?project_id={proj['id']}", headers=h)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "stages" in body
    assert "by_stage" in body
    by_stage = body["by_stage"]
    assert str(stages[0]["id"]) in map(str, by_stage.keys()) or stages[0]["id"] in by_stage
    # Stage A has 1 open, Stage B has 1 done -> pct_done 0.0 / 1.0
    stage_rows = {str(s["id"]): s for s in body["stages"]}
    assert stage_rows[str(stages[0]["id"])]["count"] == 1
    assert stage_rows[str(stages[1]["id"])]["count"] == 1

    r = client.get(
        f"/api/v1/dashboard/summary?project_id={proj['id']}&stage_id={stages[1]['id']}", headers=h
    )
    assert r.status_code == 200, r.text
    assert r.json()["total"] == 1


def test_cross_stage_move_writes_history_and_period(client: TestClient, admin_token_headers):
    h = admin_token_headers
    _, proj, _, stages, statuses = _staged_setup(client, h, "MV")
    t = _make_task(client, h, proj["id"], statuses[0]["id"], "Move me")
    r = client.get(f"/api/v1/tasks/{t['id']}/history", headers=h)
    hist_before = len(r.json())
    r = client.post(
        f"/api/v1/tasks/{t['id']}/status", json={"status_id": statuses[2]["id"]}, headers=h
    )
    assert r.status_code == 200, r.text
    assert r.json()["status_id"] == statuses[2]["id"]
    r = client.get(f"/api/v1/tasks/{t['id']}/history", headers=h)
    hist = r.json()
    assert len(hist) == hist_before + 1
    assert hist[-1]["from_status_id"] == statuses[0]["id"]
    assert hist[-1]["to_status_id"] == statuses[2]["id"]
    r = client.get(f"/api/v1/tasks/{t['id']}", headers=h)
    period_statuses = {p["status_id"] for p in r.json()["status_periods"]}
    assert statuses[2]["id"] in period_statuses
