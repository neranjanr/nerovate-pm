"""U3 seam tests: Stage-grouped Profiles + add/delete remap.

Seams under test (SPEC-v0.3 4.3 + ticket U3):
  1. Stages CRUD: CRUD /status-profiles/{id}/stages
  2. Statuses carry stage_id + shade; existing rows migrate into Stage Main
  3. Add rule: new Status appended at end of Stage, history untouched
  4. Delete rule: used Status without replacement -> 409 {usage_tasks,
     usage_periods}; with replacement -> remaps tasks.status_id, writes
     task_history, retains old periods
  5. Reference live: Category -> Profile (editing Profile visible to Projects)
  6. Seed Procurements 5+6+4 example
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


def _make_task(client: TestClient, headers, project_id: int, status_id: int, title: str = "T") -> dict:
    r = client.post(
        "/api/v1/tasks",
        json={"project_id": project_id, "title": title, "status_id": status_id,
              "start_date": "2026-01-01"},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()


def test_stages_crud(client: TestClient, admin_token_headers):
    h = admin_token_headers
    r = client.post("/api/v1/status-profiles", json={"name": "U3 Staged"}, headers=h)
    assert r.status_code == 201, r.text
    pid = r.json()["id"]

    r = client.post(
        f"/api/v1/status-profiles/{pid}/stages",
        json={"name": "Prior Approval", "color_base": "#3b82f6"},
        headers=h,
    )
    assert r.status_code == 201, r.text
    stage = r.json()
    assert stage["name"] == "Prior Approval"
    sid = stage["id"]

    r = client.get(f"/api/v1/status-profiles/{pid}/stages", headers=h)
    assert r.status_code == 200, r.text
    assert any(s["id"] == sid for s in r.json())

    r = client.put(f"/api/v1/stages/{sid}", json={"name": "Prior Renamed"}, headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["name"] == "Prior Renamed"

    r = client.delete(f"/api/v1/stages/{sid}", headers=h)
    assert r.status_code == 204, r.text


def test_existing_rows_migrate_into_main_stage(client: TestClient, admin_token_headers):
    h = admin_token_headers
    r = client.get("/api/v1/status-profiles", headers=h)
    assert r.status_code == 200, r.text
    proc = next(p for p in r.json() if p["name"] == "Procurement")
    pid = proc["id"]

    r = client.get(f"/api/v1/status-profiles/{pid}/stages", headers=h)
    assert r.status_code == 200, r.text
    stages = r.json()
    assert len(stages) >= 1
    main = next((s for s in stages if s["name"] == "Main"), stages[0])

    r = client.get(f"/api/v1/status-profiles/{pid}/statuses", headers=h)
    assert r.status_code == 200, r.text
    statuses = r.json()
    assert len(statuses) >= 1
    assert all(s.get("stage_id") == main["id"] for s in statuses)


def test_add_status_appended_and_history_untouched(client: TestClient, admin_token_headers):
    h = admin_token_headers
    r = client.post("/api/v1/status-profiles", json={"name": "U3 Add"}, headers=h)
    pid = r.json()["id"]
    r = client.post(
        f"/api/v1/status-profiles/{pid}/stages",
        json={"name": "Stage A"},
        headers=h,
    )
    stage_id = r.json()["id"]

    r = client.post(
        f"/api/v1/status-profiles/{pid}/statuses",
        json={"name": "First", "stage_id": stage_id},
        headers=h,
    )
    assert r.status_code == 201, r.text
    first = r.json()
    assert first["stage_id"] == stage_id

    cat = _make_category(client, h, "U3 Add Cat")
    r = client.patch(
        f"/api/v1/categories/{cat['id']}",
        json={"status_profile_id": pid},
        headers=h,
    )
    assert r.status_code == 200, r.text
    proj = _make_project(client, h, "Add Proj", "ADD-01", cat["id"])
    task = _make_task(client, h, proj["id"], first["id"], "Add task")
    r = client.get(f"/api/v1/tasks/{task['id']}/history", headers=h)
    hist_before = len(r.json())

    r = client.post(
        f"/api/v1/status-profiles/{pid}/statuses",
        json={"name": "Second", "stage_id": stage_id},
        headers=h,
    )
    assert r.status_code == 201, r.text
    second = r.json()
    assert second["order"] == first["order"] + 1

    # History untouched by the add.
    r = client.get(f"/api/v1/tasks/{task['id']}/history", headers=h)
    assert len(r.json()) == hist_before
    # New status visible immediately.
    r = client.get(f"/api/v1/status-profiles/{pid}/statuses", headers=h)
    assert any(s["id"] == second["id"] for s in r.json())


def test_delete_unused_status_204(client: TestClient, admin_token_headers):
    h = admin_token_headers
    r = client.post("/api/v1/status-profiles", json={"name": "U3 Del Free"}, headers=h)
    pid = r.json()["id"]
    r = client.post(
        f"/api/v1/status-profiles/{pid}/stages", json={"name": "S"}, headers=h
    )
    stage_id = r.json()["id"]
    r = client.post(
        f"/api/v1/status-profiles/{pid}/statuses",
        json={"name": "Lonely", "stage_id": stage_id},
        headers=h,
    )
    sid = r.json()["id"]
    r = client.delete(f"/api/v1/statuses/{sid}", headers=h)
    assert r.status_code == 204, r.text


def test_delete_used_without_replacement_409(client: TestClient, admin_token_headers):
    h = admin_token_headers
    r = client.post("/api/v1/status-profiles", json={"name": "U3 Del Used"}, headers=h)
    pid = r.json()["id"]
    r = client.post(
        f"/api/v1/status-profiles/{pid}/stages", json={"name": "S"}, headers=h
    )
    stage_id = r.json()["id"]
    r = client.post(
        f"/api/v1/status-profiles/{pid}/statuses",
        json={"name": "Old", "stage_id": stage_id},
        headers=h,
    )
    old_id = r.json()["id"]
    r = client.post(
        f"/api/v1/status-profiles/{pid}/statuses",
        json={"name": "New", "stage_id": stage_id},
        headers=h,
    )
    assert r.status_code == 201, r.text

    cat = _make_category(client, h, "U3 Used Cat")
    client.patch(f"/api/v1/categories/{cat['id']}",
                 json={"status_profile_id": pid}, headers=h)
    proj = _make_project(client, h, "Used Proj", "USD-01", cat["id"])
    _make_task(client, h, proj["id"], old_id, "Used task")

    r = client.delete(f"/api/v1/statuses/{old_id}", headers=h)
    assert r.status_code == 409, r.text
    body = r.json()
    detail = body.get("detail", body)
    assert detail["usage_tasks"] >= 1


def test_delete_used_with_replacement_remaps_and_writes_history(
    client: TestClient, admin_token_headers
):
    h = admin_token_headers
    r = client.post("/api/v1/status-profiles", json={"name": "U3 Remap"}, headers=h)
    pid = r.json()["id"]
    r = client.post(
        f"/api/v1/status-profiles/{pid}/stages", json={"name": "S"}, headers=h
    )
    stage_id = r.json()["id"]
    r = client.post(
        f"/api/v1/status-profiles/{pid}/statuses",
        json={"name": "Old", "stage_id": stage_id},
        headers=h,
    )
    old_id = r.json()["id"]
    r = client.post(
        f"/api/v1/status-profiles/{pid}/statuses",
        json={"name": "Replacement", "stage_id": stage_id},
        headers=h,
    )
    new_id = r.json()["id"]

    cat = _make_category(client, h, "U3 Remap Cat")
    client.patch(f"/api/v1/categories/{cat['id']}",
                 json={"status_profile_id": pid}, headers=h)
    proj = _make_project(client, h, "Remap Proj", "RMP-01", cat["id"])
    task = _make_task(client, h, proj["id"], old_id, "Remap task")

    r = client.get(f"/api/v1/tasks/{task['id']}/history", headers=h)
    hist_before = len(r.json())

    r = client.delete(f"/api/v1/statuses/{old_id}?replacement_id={new_id}", headers=h)
    assert r.status_code == 204, r.text

    r = client.get(f"/api/v1/tasks/{task['id']}", headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["status_id"] == new_id

    r = client.get(f"/api/v1/tasks/{task['id']}/history", headers=h)
    assert len(r.json()) == hist_before + 1
    last = r.json()[-1]
    assert last["from_status_id"] == old_id
    assert last["to_status_id"] == new_id


def test_category_profile_reference_is_live(client: TestClient, admin_token_headers):
    h = admin_token_headers
    r = client.post("/api/v1/status-profiles", json={"name": "U3 Live"}, headers=h)
    pid = r.json()["id"]
    r = client.post(
        f"/api/v1/status-profiles/{pid}/stages", json={"name": "S1"}, headers=h
    )
    s1 = r.json()["id"]

    cat = _make_category(client, h, "U3 Live Cat")
    client.patch(f"/api/v1/categories/{cat['id']}",
                 json={"status_profile_id": pid}, headers=h)
    proj = _make_project(client, h, "Live Proj", "LVE-01", cat["id"])

    # Editing the profile is immediately visible (no per-project copy).
    r = client.post(
        f"/api/v1/status-profiles/{pid}/statuses",
        json={"name": "Live Added", "stage_id": s1},
        headers=h,
    )
    assert r.status_code == 201, r.text
    added_id = r.json()["id"]

    r = client.get(f"/api/v1/status-profiles/{pid}/statuses", headers=h)
    assert any(s["id"] == added_id for s in r.json())
    # Project resolves its profile via the parent Category (live reference).
    assert proj["category_id"] == cat["id"]
    r = client.get(f"/api/v1/categories/{cat['id']}", headers=h)
    assert r.json()["status_profile_id"] == pid


def test_seed_procurements_5_6_4(client: TestClient, admin_token_headers):
    h = admin_token_headers
    r = client.get("/api/v1/status-profiles", headers=h)
    assert r.status_code == 200, r.text
    profiles = r.json()
    staged = next(
        (p for p in profiles if len(p.get("statuses", [])) == 15),
        None,
    )
    assert staged is not None, "expected a seeded 5+6+4 profile"
    r = client.get(f"/api/v1/status-profiles/{staged['id']}/stages", headers=h)
    assert r.status_code == 200, r.text
    stages = sorted(r.json(), key=lambda s: s["order"])
    assert len(stages) == 3
    counts = []
    for st in stages:
        r = client.get(f"/api/v1/stages/{st['id']}/statuses", headers=h)
        assert r.status_code == 200, r.text
        counts.append(len(r.json()))
    assert counts == [5, 6, 4]
