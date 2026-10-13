"""ADR-0010 core tests: empty Stage directly assignable (issue 01).

Seams under test:
  1. signals.empty_stage_signal() renders 100% with the full glyph.
  2. Task create/update/status-change accept stage_id only for empty Stages
     (zero Statuses); non-empty Stages are rejected (400) on every path.
  3. status_id and stage_id are mutually exclusive (exactly-one node).
  4. Stage filters include direct assignments; defaults fall back to the
     first empty Stage when no leaf exists.
  5. History records stage legs; periods stay leaf-only.
"""

from fastapi.testclient import TestClient

from app.statuses.signals import derive_status_signal, empty_stage_signal


def _make_profile(client: TestClient, headers, name: str = "EmptyStage") -> int:
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


def _make_status(
    client: TestClient, headers, profile_id: int, stage_id: int, name: str = "Leaf"
) -> dict:
    r = client.post(
        f"/api/v1/status-profiles/{profile_id}/statuses",
        json={"name": name, "stage_id": stage_id},
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


def _setup_empty_stage(
    client: TestClient, headers, tag: str = "E"
) -> tuple[int, dict, dict]:
    """Profile with one empty Stage + linked Category/Project."""
    pid = _make_profile(client, headers, f"EmptyStage {tag}")
    stage = _make_stage(client, headers, pid, f"Solo {tag}")
    cat = _make_category_with_profile(client, headers, f"Empty Cat {tag}", pid)
    proj = _make_project(client, headers, f"Empty Proj {tag}", f"EMP-{tag}", cat["id"])
    return pid, stage, proj


def test_empty_stage_signal_is_full():
    glyph, percent = empty_stage_signal()
    assert (glyph, percent) == ("●", 100)
    assert empty_stage_signal() == derive_status_signal(0, 1)


def test_create_task_on_empty_stage(client: TestClient, admin_token_headers):
    h = admin_token_headers
    _pid, stage, proj = _setup_empty_stage(client, h, "C1")
    r = client.post(
        "/api/v1/tasks",
        json={"project_id": proj["id"], "title": "On stage", "stage_id": stage["id"]},
        headers=h,
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["stage_id"] == stage["id"]
    assert body["status_id"] is None


def test_create_task_on_nonempty_stage_rejected(client: TestClient, admin_token_headers):
    h = admin_token_headers
    pid, stage, proj = _setup_empty_stage(client, h, "C2")
    _make_status(client, h, pid, stage["id"], "First leaf")
    r = client.post(
        "/api/v1/tasks",
        json={"project_id": proj["id"], "title": "Bad", "stage_id": stage["id"]},
        headers=h,
    )
    assert r.status_code == 400, r.text
    assert "leaf Status" in r.json()["detail"]


def test_create_task_with_both_nodes_rejected(client: TestClient, admin_token_headers):
    h = admin_token_headers
    pid, stage, proj = _setup_empty_stage(client, h, "C3")
    leaf = _make_status(client, h, pid, stage["id"], "Leaf")
    # Stage is non-empty now, but the XOR check fires first either way.
    r = client.post(
        "/api/v1/tasks",
        json={
            "project_id": proj["id"],
            "title": "Both",
            "status_id": leaf["id"],
            "stage_id": stage["id"],
        },
        headers=h,
    )
    assert r.status_code == 400, r.text

    pid2 = _make_profile(client, h, "EmptyStage C3b")
    stage2 = _make_stage(client, h, pid2, "Solo C3b")
    cat2 = _make_category_with_profile(client, h, "Empty Cat C3b", pid2)
    proj2 = _make_project(client, h, "Empty Proj C3b", "EMP-C3B", cat2["id"])
    leaf2 = _make_status(client, h, pid, stage["id"], "Leaf 2")
    r = client.post(
        "/api/v1/tasks",
        json={
            "project_id": proj2["id"],
            "title": "Both empty",
            "status_id": leaf2["id"],
            "stage_id": stage2["id"],
        },
        headers=h,
    )
    assert r.status_code == 400, r.text


def test_create_task_stage_outside_profile_rejected(
    client: TestClient, admin_token_headers
):
    h = admin_token_headers
    _pid, _stage, proj = _setup_empty_stage(client, h, "C4")
    other_pid = _make_profile(client, h, "Other C4")
    other_stage = _make_stage(client, h, other_pid, "Other solo")
    r = client.post(
        "/api/v1/tasks",
        json={
            "project_id": proj["id"],
            "title": "Foreign",
            "stage_id": other_stage["id"],
        },
        headers=h,
    )
    assert r.status_code == 400, r.text


def test_create_task_unknown_stage_rejected(client: TestClient, admin_token_headers):
    h = admin_token_headers
    _pid, _stage, proj = _setup_empty_stage(client, h, "C5")
    r = client.post(
        "/api/v1/tasks",
        json={"project_id": proj["id"], "title": "Ghost", "stage_id": 999999},
        headers=h,
    )
    assert r.status_code == 400, r.text


def test_update_task_onto_empty_stage_and_back(client: TestClient, admin_token_headers):
    h = admin_token_headers
    pid, stage, proj = _setup_empty_stage(client, h, "U1")
    other_stage = _make_stage(client, h, pid, "Second")
    leaf = _make_status(client, h, pid, other_stage["id"], "Leaf")
    r = client.post(
        "/api/v1/tasks",
        json={"project_id": proj["id"], "title": "Mover", "status_id": leaf["id"]},
        headers=h,
    )
    assert r.status_code == 201, r.text
    task_id = r.json()["id"]

    # Leaf -> empty Stage via PUT.
    r = client.put(f"/api/v1/tasks/{task_id}", json={"stage_id": stage["id"]}, headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["stage_id"] == stage["id"]
    assert r.json()["status_id"] is None

    r = client.get(f"/api/v1/tasks/{task_id}/history", headers=h)
    assert r.status_code == 200, r.text
    last = r.json()[-1]
    assert last["from_status_id"] == leaf["id"]
    assert last["to_status_id"] is None
    assert last["to_stage_id"] == stage["id"]

    # Empty Stage -> leaf via PUT records the stage leg.
    r = client.put(f"/api/v1/tasks/{task_id}", json={"status_id": leaf["id"]}, headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["status_id"] == leaf["id"]
    assert r.json()["stage_id"] is None

    r = client.get(f"/api/v1/tasks/{task_id}/history", headers=h)
    last = r.json()[-1]
    assert last["from_stage_id"] == stage["id"]
    assert last["to_status_id"] == leaf["id"]

    # PUT onto a non-empty Stage is rejected.
    r = client.put(
        f"/api/v1/tasks/{task_id}", json={"stage_id": other_stage["id"]}, headers=h
    )
    assert r.status_code == 400, r.text


def test_status_change_endpoint_stage_paths(client: TestClient, admin_token_headers):
    h = admin_token_headers
    pid, stage, proj = _setup_empty_stage(client, h, "S1")
    other_stage = _make_stage(client, h, pid, "Second S1")
    leaf = _make_status(client, h, pid, other_stage["id"], "Leaf S1")
    r = client.post(
        "/api/v1/tasks",
        json={"project_id": proj["id"], "title": "Switcher", "status_id": leaf["id"]},
        headers=h,
    )
    task_id = r.json()["id"]

    # Neither node -> 400.
    r = client.post(f"/api/v1/tasks/{task_id}/status", json={}, headers=h)
    assert r.status_code == 400, r.text
    # Both nodes -> 400.
    r = client.post(
        f"/api/v1/tasks/{task_id}/status",
        json={"status_id": leaf["id"], "stage_id": stage["id"]},
        headers=h,
    )
    assert r.status_code == 400, r.text
    # Non-empty Stage -> 400.
    r = client.post(
        f"/api/v1/tasks/{task_id}/status",
        json={"stage_id": other_stage["id"]},
        headers=h,
    )
    assert r.status_code == 400, r.text

    # Leaf -> empty Stage.
    r = client.post(
        f"/api/v1/tasks/{task_id}/status",
        json={"stage_id": stage["id"]},
        headers=h,
    )
    assert r.status_code == 200, r.text
    assert r.json()["stage_id"] == stage["id"]
    assert r.json()["status_id"] is None

    # Empty Stage -> leaf.
    r = client.post(
        f"/api/v1/tasks/{task_id}/status",
        json={"status_id": leaf["id"]},
        headers=h,
    )
    assert r.status_code == 200, r.text
    assert r.json()["status_id"] == leaf["id"]


def test_stage_filter_includes_direct_assignments(
    client: TestClient, admin_token_headers
):
    h = admin_token_headers
    pid, stage, proj = _setup_empty_stage(client, h, "F1")
    other_stage = _make_stage(client, h, pid, "Second F1")
    leaf = _make_status(client, h, pid, other_stage["id"], "Leaf F1")
    r = client.post(
        "/api/v1/tasks",
        json={"project_id": proj["id"], "title": "Direct", "stage_id": stage["id"]},
        headers=h,
    )
    assert r.status_code == 201, r.text
    direct_id = r.json()["id"]
    r = client.post(
        "/api/v1/tasks",
        json={"project_id": proj["id"], "title": "Leafy", "status_id": leaf["id"]},
        headers=h,
    )
    assert r.status_code == 201, r.text

    r = client.get(
        f"/api/v1/tasks?project_id={proj['id']}&stage_id={stage['id']}", headers=h
    )
    assert r.status_code == 200, r.text
    assert [t["id"] for t in r.json()] == [direct_id]

    r = client.get(
        f"/api/v1/tasks?project_id={proj['id']}&stage_id={other_stage['id']}",
        headers=h,
    )
    assert r.status_code == 200, r.text
    assert all(t["status_id"] == leaf["id"] for t in r.json())


def test_defaults_fall_back_to_empty_stage(client: TestClient, admin_token_headers):
    h = admin_token_headers
    _pid, stage, proj = _setup_empty_stage(client, h, "D1")
    r = client.get(f"/api/v1/tasks/defaults?project_id={proj['id']}", headers=h)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status_id"] is None
    assert body["stage_id"] == stage["id"]
    assert body["stage_name"] == stage["name"]

    # Title-only create lands on the empty Stage.
    r = client.post(
        "/api/v1/tasks", json={"project_id": proj["id"], "title": "Defaulted"}, headers=h
    )
    assert r.status_code == 201, r.text
    assert r.json()["stage_id"] == stage["id"]
    assert r.json()["status_id"] is None


def test_schema_has_stage_columns(client: TestClient, admin_token_headers):
    from sqlalchemy import text

    from app import db as db_module
    from sqlmodel import Session

    with Session(db_module.engine) as session:
        task_cols = {r[1]: r for r in session.execute(text("PRAGMA table_info(tasks)")).all()}
        assert "stage_id" in task_cols
        assert task_cols["status_id"][3] == 0  # nullable
        hist_cols = {r[1]: r for r in session.execute(text("PRAGMA table_info(task_history)")).all()}
        assert "from_stage_id" in hist_cols
        assert "to_stage_id" in hist_cols
        assert hist_cols["to_status_id"][3] == 0  # nullable
