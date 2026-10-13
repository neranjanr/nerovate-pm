"""ADR-0010 issue 02: first-Status auto-migrate plus drag picker (backend half).

Seams under test:
  1. Creating the first Status under a previously-empty assigned Stage
     auto-migrates directly-assigned Tasks onto the new Status.
  2. Each migrated Task gets a `status-migrated` history entry
     (from_stage_id -> to_status_id) and ends on exactly one assignable node.
  3. Second Status creation migrates nothing (stage already non-empty).
  4. Moving an existing Status into an empty assigned Stage also migrates.
"""

from fastapi.testclient import TestClient


def _make_profile(client: TestClient, headers, name: str = "Migrate") -> int:
    r = client.post("/api/v1/status-profiles", json={"name": name}, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _make_stage(client: TestClient, headers, profile_id: int, name: str = "Solo") -> dict:
    r = client.post(
        f"/api/v1/status-profiles/{profile_id}/stages",
        json={"name": name},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()


def _make_category_with_profile(
    client: TestClient, headers, name: str, profile_id: int
) -> dict:
    r = client.post("/api/v1/categories", json={"name": name}, headers=headers)
    assert r.status_code == 201, r.text
    cat = r.json()
    r = client.patch(
        f"/api/v1/categories/{cat['id']}",
        json={"status_profile_id": profile_id},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    return r.json()


def _make_project(
    client: TestClient, headers, name: str, code: str, category_id: int
) -> dict:
    r = client.post(
        "/api/v1/projects",
        json={"name": name, "code": code, "category_id": category_id},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()


def _setup(client: TestClient, headers, tag: str = "M"):
    pid = _make_profile(client, headers, f"Migrate {tag}")
    stage = _make_stage(client, headers, pid, f"Solo {tag}")
    cat = _make_category_with_profile(client, headers, f"Mig Cat {tag}", pid)
    proj = _make_project(client, headers, f"Mig Proj {tag}", f"MIG-{tag}", cat["id"])
    return pid, stage, proj


def _create_task_on_stage(client, h, proj, stage, title="Direct"):
    r = client.post(
        "/api/v1/tasks",
        json={"project_id": proj["id"], "title": title, "stage_id": stage["id"]},
        headers=h,
    )
    assert r.status_code == 201, r.text
    return r.json()


def test_first_status_migrates_direct_tasks_with_history(
    client: TestClient, admin_token_headers
):
    h = admin_token_headers
    pid, stage, proj = _setup(client, h, "A1")
    t1 = _create_task_on_stage(client, h, proj, stage, "One")
    t2 = _create_task_on_stage(client, h, proj, stage, "Two")

    r = client.post(
        f"/api/v1/status-profiles/{pid}/statuses",
        json={"name": "First leaf", "stage_id": stage["id"]},
        headers=h,
    )
    assert r.status_code == 201, r.text
    leaf = r.json()

    for tid in (t1["id"], t2["id"]):
        r = client.get(f"/api/v1/tasks/{tid}", headers=h)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["status_id"] == leaf["id"], body
        assert body["stage_id"] is None, body

        r = client.get(f"/api/v1/tasks/{tid}/history", headers=h)
        assert r.status_code == 200, r.text
        # Last entry is the auto-migration leg.
        last = r.json()[-1]
        assert last["from_stage_id"] == stage["id"], last
        assert last["to_status_id"] == leaf["id"], last
        assert last["from_status_id"] is None, last
        assert (last.get("note") or "") == "status-migrated", last


def test_first_status_via_stage_route_also_migrates(
    client: TestClient, admin_token_headers
):
    h = admin_token_headers
    pid, stage, proj = _setup(client, h, "A2")
    t1 = _create_task_on_stage(client, h, proj, stage, "One")

    r = client.post(
        f"/api/v1/stages/{stage['id']}/statuses",
        json={"name": "First via stage route"},
        headers=h,
    )
    assert r.status_code == 201, r.text
    leaf = r.json()

    r = client.get(f"/api/v1/tasks/{t1['id']}", headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["status_id"] == leaf["id"]
    assert r.json()["stage_id"] is None

    r = client.get(f"/api/v1/tasks/{t1['id']}/history", headers=h)
    last = r.json()[-1]
    assert last["from_stage_id"] == stage["id"]
    assert last["to_status_id"] == leaf["id"]
    assert (last.get("note") or "") == "status-migrated"


def test_second_status_migrates_nothing(client: TestClient, admin_token_headers):
    h = admin_token_headers
    pid, stage, proj = _setup(client, h, "A3")
    t1 = _create_task_on_stage(client, h, proj, stage, "One")

    r = client.post(
        f"/api/v1/status-profiles/{pid}/statuses",
        json={"name": "First", "stage_id": stage["id"]},
        headers=h,
    )
    assert r.status_code == 201, r.text
    first = r.json()

    # Move the migrated task elsewhere is not needed; create a task on the
    # first leaf, then add a second leaf — no stage-assigned rows remain.
    r = client.post(
        "/api/v1/tasks",
        json={"project_id": proj["id"], "title": "Leafy", "status_id": first["id"]},
        headers=h,
    )
    assert r.status_code == 201, r.text
    leafy_id = r.json()["id"]

    r = client.get(f"/api/v1/tasks/{t1['id']}/history", headers=h)
    hist_before = len(r.json())

    r = client.post(
        f"/api/v1/status-profiles/{pid}/statuses",
        json={"name": "Second", "stage_id": stage["id"]},
        headers=h,
    )
    assert r.status_code == 201, r.text

    # The previously-migrated task is untouched by the second insert.
    r = client.get(f"/api/v1/tasks/{t1['id']}", headers=h)
    assert r.json()["status_id"] == first["id"]
    r = client.get(f"/api/v1/tasks/{t1['id']}/history", headers=h)
    assert len(r.json()) == hist_before, r.json()

    r = client.get(f"/api/v1/tasks/{leafy_id}", headers=h)
    assert r.json()["status_id"] == first["id"]


def test_move_status_into_empty_stage_migrates(
    client: TestClient, admin_token_headers
):
    h = admin_token_headers
    pid, stage, proj = _setup(client, h, "A4")
    t1 = _create_task_on_stage(client, h, proj, stage, "One")

    other_stage = _make_stage(client, h, pid, "Other A4")
    r = client.post(
        f"/api/v1/status-profiles/{pid}/statuses",
        json={"name": "Wanderer", "stage_id": other_stage["id"]},
        headers=h,
    )
    assert r.status_code == 201, r.text
    wanderer = r.json()

    # Move the leaf Status under the assigned empty Stage -> first Status there.
    r = client.put(
        f"/api/v1/status-profiles/{pid}/statuses/{wanderer['id']}",
        json={"stage_id": stage["id"]},
        headers=h,
    )
    assert r.status_code == 200, r.text

    r = client.get(f"/api/v1/tasks/{t1['id']}", headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["status_id"] == wanderer["id"], r.json()
    assert r.json()["stage_id"] is None

    r = client.get(f"/api/v1/tasks/{t1['id']}/history", headers=h)
    last = r.json()[-1]
    assert last["from_stage_id"] == stage["id"]
    assert last["to_status_id"] == wanderer["id"]
    assert (last.get("note") or "") == "status-migrated"


def test_subtask_on_empty_stage_also_migrates(
    client: TestClient, admin_token_headers
):
    h = admin_token_headers
    pid, stage, proj = _setup(client, h, "A5")
    parent = _create_task_on_stage(client, h, proj, stage, "Parent")
    r = client.post(
        "/api/v1/tasks",
        json={
            "project_id": proj["id"],
            "parent_id": parent["id"],
            "title": "Child",
            "stage_id": stage["id"],
        },
        headers=h,
    )
    assert r.status_code == 201, r.text
    child_id = r.json()["id"]

    r = client.post(
        f"/api/v1/status-profiles/{pid}/statuses",
        json={"name": "First", "stage_id": stage["id"]},
        headers=h,
    )
    assert r.status_code == 201, r.text
    leaf = r.json()

    for tid in (parent["id"], child_id):
        r = client.get(f"/api/v1/tasks/{tid}", headers=h)
        assert r.json()["status_id"] == leaf["id"], r.json()
        assert r.json()["stage_id"] is None
