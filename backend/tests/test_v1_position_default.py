"""V1 seam tests: Sibling position + Project tree default (Phase-4 blocker).

Seams under test (docs/tickets/phase4/V1-position-default.md + SPEC-v0.4):
  1. POST /api/v1/tasks/reorder {item_id, to_position} same-parent only,
     returns renumbered siblings with fresh WBS; cross-parent -> 400.
  2. GET/PATCH /api/v1/projects/{id}/tree-default Owner-only write.
  3. Migration backfill preserves creation (id) order.
  4. Reorder writes task_history, creates no task_status_periods,
     sends no Assignee/Watcher side effects (period count unchanged).
"""

from fastapi.testclient import TestClient


def _make_user(client: TestClient, headers, username: str, role: str) -> int:
    r = client.post(
        "/api/v1/users",
        json={"username": username, "password": "pass12345", "name": username, "role": role},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _login(client: TestClient, username: str, password: str) -> dict:
    r = client.post("/api/v1/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


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


def _make_task(client: TestClient, headers, project_id: int, title: str, parent_id=None) -> dict:
    payload: dict = {"project_id": project_id, "title": title}
    if parent_id is not None:
        payload["parent_id"] = parent_id
    r = client.post("/api/v1/tasks", json=payload, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


def _setup_proj(client: TestClient, headers, tag: str) -> dict:
    cat = _make_category(client, headers, f"V1 Cat {tag}")
    r = client.post("/api/v1/status-profiles", json={"name": f"V1 Prof {tag}"}, headers=headers)
    assert r.status_code == 201, r.text
    prof_id = r.json()["id"]
    r = client.post(
        f"/api/v1/status-profiles/{prof_id}/stages", json={"name": "Stage"}, headers=headers
    )
    assert r.status_code == 201, r.text
    stage_id = r.json()["id"]
    r = client.post(
        f"/api/v1/status-profiles/{prof_id}/statuses",
        json={"name": "Open", "stage_id": stage_id},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    r = client.patch(
        f"/api/v1/categories/{cat['id']}", json={"status_profile_id": prof_id}, headers=headers
    )
    assert r.status_code == 200, r.text
    return _make_project(client, headers, f"V1 Proj {tag}", f"V1-{tag[:2].upper()}1", cat["id"])


def test_same_parent_reorder_persists_and_wbs_renumbers(client: TestClient, admin_token_headers):
    h = admin_token_headers
    proj = _setup_proj(client, h, "R1")
    pid = proj["id"]
    a = _make_task(client, h, pid, "A")
    b = _make_task(client, h, pid, "B")
    c = _make_task(client, h, pid, "C")

    # Initial WBS follows creation order: A=1, B=2, C=3.
    assert a["wbs"] == "1"
    assert b["wbs"] == "2"
    assert c["wbs"] == "3"

    r = client.post(
        "/api/v1/tasks/reorder",
        json={"item_id": c["id"], "to_position": 1},
        headers=h,
    )
    assert r.status_code == 200, r.text
    siblings = r.json()
    assert [s["title"] for s in siblings] == ["C", "A", "B"]
    assert [s["wbs"] for s in siblings] == ["1", "2", "3"]
    assert [s["position"] for s in siblings] == [1, 2, 3]

    # Persists on refetch.
    r = client.get(f"/api/v1/tasks?project_id={pid}", headers=h)
    assert r.status_code == 200, r.text
    by_title = {t["title"]: t for t in r.json()}
    assert by_title["C"]["wbs"] == "1"
    assert by_title["A"]["wbs"] == "2"
    assert by_title["B"]["wbs"] == "3"


def test_subtask_reorder_scoped_to_same_parent_and_wbs(client: TestClient, admin_token_headers):
    h = admin_token_headers
    proj = _setup_proj(client, h, "R2")
    pid = proj["id"]
    root1 = _make_task(client, h, pid, "Root1")
    root2 = _make_task(client, h, pid, "Root2")
    s1 = _make_task(client, h, pid, "S1", parent_id=root1["id"])
    s2 = _make_task(client, h, pid, "S2", parent_id=root1["id"])
    other = _make_task(client, h, pid, "Other", parent_id=root2["id"])
    assert s1["wbs"] == "1.1"
    assert s2["wbs"] == "1.2"

    r = client.post(
        "/api/v1/tasks/reorder",
        json={"item_id": s2["id"], "to_position": 1},
        headers=h,
    )
    assert r.status_code == 200, r.text
    siblings = r.json()
    assert [s["title"] for s in siblings] == ["S2", "S1"]
    assert [s["wbs"] for s in siblings] == ["1.1", "1.2"]
    # Other parent's children untouched.
    r = client.get(f"/api/v1/tasks/{other['id']}", headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["wbs"] == "2.1"


def test_cross_parent_rejected(client: TestClient, admin_token_headers):
    h = admin_token_headers
    proj = _setup_proj(client, h, "R3")
    pid = proj["id"]
    root1 = _make_task(client, h, pid, "Root1")
    root2 = _make_task(client, h, pid, "Root2")
    s1 = _make_task(client, h, pid, "S1", parent_id=root1["id"])

    # Explicit parent mismatch must be rejected, order untouched.
    r = client.post(
        "/api/v1/tasks/reorder",
        json={"item_id": s1["id"], "to_position": 1, "parent_id": root2["id"]},
        headers=h,
    )
    assert r.status_code == 400, r.text
    r = client.get(f"/api/v1/tasks/{s1['id']}", headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["parent_id"] == root1["id"]


def test_reorder_permissions_member_ok_guest_403(client: TestClient, admin_token_headers):
    h = admin_token_headers
    proj = _setup_proj(client, h, "R4")
    pid = proj["id"]
    a = _make_task(client, h, pid, "A")
    b = _make_task(client, h, pid, "B")

    member_id = _make_user(client, h, "v1member", "member")
    guest_id = _make_user(client, h, "v1guest", "guest")
    for uid, role in ((member_id, "member"), (guest_id, "guest")):
        r = client.post(
            f"/api/v1/projects/{pid}/members",
            json={"user_id": uid, "role": role},
            headers=h,
        )
        assert r.status_code == 201, r.text
    mh = _login(client, "v1member", "pass12345")
    gh = _login(client, "v1guest", "pass12345")

    r = client.post(
        "/api/v1/tasks/reorder", json={"item_id": b["id"], "to_position": 1}, headers=mh
    )
    assert r.status_code == 200, r.text
    assert [s["title"] for s in r.json()] == ["B", "A"]

    r = client.post(
        "/api/v1/tasks/reorder", json={"item_id": b["id"], "to_position": 2}, headers=gh
    )
    assert r.status_code == 403, r.text


def test_tree_default_owner_ok_member_403_guest_403(client: TestClient, admin_token_headers):
    h = admin_token_headers
    proj = _setup_proj(client, h, "R5")
    pid = proj["id"]

    # Default is all.
    r = client.get(f"/api/v1/projects/{pid}/tree-default", headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["tree_default"] == "all"

    member_id = _make_user(client, h, "v1member2", "member")
    guest_id = _make_user(client, h, "v1guest2", "guest")
    for uid, role in ((member_id, "member"), (guest_id, "guest")):
        r = client.post(
            f"/api/v1/projects/{pid}/members",
            json={"user_id": uid, "role": role},
            headers=h,
        )
        assert r.status_code == 201, r.text
    mh = _login(client, "v1member2", "pass12345")
    gh = _login(client, "v1guest2", "pass12345")

    # Member read ok, write forbidden.
    r = client.get(f"/api/v1/projects/{pid}/tree-default", headers=mh)
    assert r.status_code == 200, r.text
    r = client.patch(
        f"/api/v1/projects/{pid}/tree-default", json={"tree_default": "tasks-only"}, headers=mh
    )
    assert r.status_code == 403, r.text

    r = client.patch(
        f"/api/v1/projects/{pid}/tree-default", json={"tree_default": "tasks-only"}, headers=gh
    )
    assert r.status_code == 403, r.text

    # Owner (creator/admin) can set.
    r = client.patch(
        f"/api/v1/projects/{pid}/tree-default",
        json={"tree_default": "tasks-subtasks"},
        headers=h,
    )
    assert r.status_code == 200, r.text
    assert r.json()["tree_default"] == "tasks-subtasks"

    # Invalid value rejected.
    r = client.patch(
        f"/api/v1/projects/{pid}/tree-default", json={"tree_default": "nope"}, headers=h
    )
    assert r.status_code in (400, 422), r.text


def test_reorder_writes_history_no_period_change(client: TestClient, admin_token_headers):
    h = admin_token_headers
    proj = _setup_proj(client, h, "R6")
    pid = proj["id"]
    a = _make_task(client, h, pid, "A")
    b = _make_task(client, h, pid, "B")

    r = client.get(f"/api/v1/tasks/{b['id']}/history", headers=h)
    assert r.status_code == 200, r.text
    hist_before = len(r.json())
    r = client.get(f"/api/v1/tasks/{b['id']}", headers=h)
    periods_before = len(r.json()["status_periods"])

    r = client.post(
        "/api/v1/tasks/reorder", json={"item_id": b["id"], "to_position": 1}, headers=h
    )
    assert r.status_code == 200, r.text

    r = client.get(f"/api/v1/tasks/{b['id']}/history", headers=h)
    assert r.status_code == 200, r.text
    assert len(r.json()) == hist_before + 1
    r = client.get(f"/api/v1/tasks/{b['id']}", headers=h)
    assert len(r.json()["status_periods"]) == periods_before


def test_backfill_preserves_id_order(client: TestClient, admin_token_headers):
    """Legacy NULL positions backfill in creation (id) order per parent scope."""
    h = admin_token_headers
    proj = _setup_proj(client, h, "R7")
    pid = proj["id"]
    ids = [_make_task(client, h, pid, f"T{i}")["id"] for i in range(3)]

    from app import db as db_module
    from sqlmodel import Session
    from sqlalchemy import text as sa_text

    with Session(db_module.engine) as session:
        session.execute(sa_text("UPDATE tasks SET position = NULL WHERE project_id = :p").bindparams(p=pid))
        session.commit()
    db_module._migrate_task_positions()

    r = client.get(f"/api/v1/tasks?project_id={pid}", headers=h)
    assert r.status_code == 200, r.text
    got = [t["id"] for t in r.json()]
    assert got == sorted(ids)
    assert [t["position"] for t in r.json()] == [1, 2, 3]
