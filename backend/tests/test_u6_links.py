"""U6 seam tests: cross-Category Project links (plain).

Seams under test (SPEC-v0.3 4.2 + ticket U6 + ADR-0006):
  1. POST/GET/DELETE /projects/{id}/links CRUD + enriched chips payload
  2. Rules: no self-link (422), pair+kind unique (422), kind validated
  3. Cross-Category allowed; no rollup (Board/Timeline stay per-Project)
  4. Access: non-member 404 (no enumeration), guest write 403
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


def _setup_pair(client: TestClient, headers, tag: str = "U6"):
    cat_a = _make_category(client, headers, f"{tag} Procurements")
    cat_b = _make_category(client, headers, f"{tag} OPEX Items")
    proj_a = _make_project(client, headers, "Buy server", "SRV-01", cat_a["id"])
    proj_b = _make_project(client, headers, "Buy server", "SRV-01", cat_b["id"])
    return cat_a, cat_b, proj_a, proj_b


def test_create_and_list_cross_category_link(client: TestClient, admin_token_headers):
    h = admin_token_headers
    cat_a, cat_b, proj_a, proj_b = _setup_pair(client, h)
    r = client.post(
        f"/api/v1/projects/{proj_a['id']}/links",
        json={"to_project_id": proj_b["id"], "kind": "continues-as", "note": "opex tracker"},
        headers=h,
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["from_project_id"] == proj_a["id"]
    assert body["to_project_id"] == proj_b["id"]
    assert body["kind"] == "continues-as"
    # Enriched chips payload for `Category / Project` jump.
    assert body.get("to_project_code") == "SRV-01"
    assert body.get("to_category_name") == cat_b["name"]

    r = client.get(f"/api/v1/projects/{proj_a['id']}/links", headers=h)
    assert r.status_code == 200, r.text
    rows = r.json()
    assert len(rows) == 1
    assert rows[0]["to_category_name"] == cat_b["name"]


def test_self_link_422_and_bad_kind_422(client: TestClient, admin_token_headers):
    h = admin_token_headers
    _, _, proj_a, _ = _setup_pair(client, h, "U6Self")
    r = client.post(
        f"/api/v1/projects/{proj_a['id']}/links",
        json={"to_project_id": proj_a["id"], "kind": "relates-to"},
        headers=h,
    )
    assert r.status_code == 422, r.text

    r = client.post(
        f"/api/v1/projects/{proj_a['id']}/links",
        json={"to_project_id": 999999, "kind": "blocked-by"},
        headers=h,
    )
    assert r.status_code == 422, r.text


def test_duplicate_pair_kind_422_other_kind_ok(client: TestClient, admin_token_headers):
    h = admin_token_headers
    _, _, proj_a, proj_b = _setup_pair(client, h, "U6Dup")
    r = client.post(
        f"/api/v1/projects/{proj_a['id']}/links",
        json={"to_project_id": proj_b["id"], "kind": "relates-to"},
        headers=h,
    )
    assert r.status_code == 201, r.text
    r = client.post(
        f"/api/v1/projects/{proj_a['id']}/links",
        json={"to_project_id": proj_b["id"], "kind": "relates-to"},
        headers=h,
    )
    assert r.status_code == 422, r.text
    # Same pair, different kind is a distinct link.
    r = client.post(
        f"/api/v1/projects/{proj_a['id']}/links",
        json={"to_project_id": proj_b["id"], "kind": "continues-as"},
        headers=h,
    )
    assert r.status_code == 201, r.text


def test_delete_link(client: TestClient, admin_token_headers):
    h = admin_token_headers
    _, _, proj_a, proj_b = _setup_pair(client, h, "U6Del")
    r = client.post(
        f"/api/v1/projects/{proj_a['id']}/links",
        json={"to_project_id": proj_b["id"], "kind": "relates-to"},
        headers=h,
    )
    assert r.status_code == 201, r.text
    link_id = r.json()["id"]
    r = client.delete(f"/api/v1/projects/{proj_a['id']}/links/{link_id}", headers=h)
    assert r.status_code == 204, r.text
    r = client.get(f"/api/v1/projects/{proj_a['id']}/links", headers=h)
    assert r.status_code == 200, r.text
    assert r.json() == []


def test_no_rollup_board_timeline_stay_per_project(client: TestClient, admin_token_headers):
    h = admin_token_headers
    cat_a, cat_b, proj_a, proj_b = _setup_pair(client, h, "U6Iso")
    # Title-only tasks need a staged profile on both Categories (U4 defaults).
    r = client.post("/api/v1/status-profiles", json={"name": "U6Iso Prof"}, headers=h)
    assert r.status_code == 201, r.text
    pid = r.json()["id"]
    r = client.post(f"/api/v1/status-profiles/{pid}/stages", json={"name": "Stage"}, headers=h)
    assert r.status_code == 201, r.text
    stage_id = r.json()["id"]
    r = client.post(
        f"/api/v1/status-profiles/{pid}/statuses",
        json={"name": "Todo", "stage_id": stage_id},
        headers=h,
    )
    assert r.status_code == 201, r.text
    for cat in (cat_a, cat_b):
        r = client.patch(
            f"/api/v1/categories/{cat['id']}", json={"status_profile_id": pid}, headers=h
        )
        assert r.status_code == 200, r.text
    r = client.post(
        f"/api/v1/projects/{proj_a['id']}/links",
        json={"to_project_id": proj_b["id"], "kind": "continues-as"},
        headers=h,
    )
    assert r.status_code == 201, r.text
    for pid, title in ((proj_a["id"], "A task"), (proj_b["id"], "B task")):
        r = client.post(
            "/api/v1/tasks", json={"project_id": pid, "title": title}, headers=h
        )
        assert r.status_code == 201, r.text
    r = client.get(f"/api/v1/tasks?project_id={proj_a['id']}", headers=h)
    assert r.status_code == 200, r.text
    assert [t["title"] for t in r.json()] == ["A task"]
    r = client.get(f"/api/v1/tasks/timeline?project_id={proj_a['id']}", headers=h)
    assert r.status_code == 200, r.text
    assert [t["title"] for t in r.json()] == ["A task"]


def test_non_member_404_and_guest_write_403(client: TestClient, admin_token_headers):
    h = admin_token_headers
    _, _, proj_a, proj_b = _setup_pair(client, h, "U6Gate")
    outsider_id = _make_user(client, h, "u6outsider", "member")
    guest_id = _make_user(client, h, "u6guest", "guest")
    assert outsider_id != guest_id
    outsider_h = _login(client, "u6outsider", "pass12345")
    guest_h = _login(client, "u6guest", "pass12345")

    r = client.get(f"/api/v1/projects/{proj_a['id']}/links", headers=outsider_h)
    assert r.status_code == 404, r.text
    r = client.post(
        f"/api/v1/projects/{proj_a['id']}/links",
        json={"to_project_id": proj_b["id"], "kind": "relates-to"},
        headers=outsider_h,
    )
    assert r.status_code == 404, r.text

    # Guest with project membership can read but not write.
    r = client.post(
        f"/api/v1/projects/{proj_a['id']}/members",
        json={"user_id": guest_id, "role": "guest"},
        headers=h,
    )
    assert r.status_code == 201, r.text
    r = client.get(f"/api/v1/projects/{proj_a['id']}/links", headers=guest_h)
    assert r.status_code == 200, r.text
    r = client.post(
        f"/api/v1/projects/{proj_a['id']}/links",
        json={"to_project_id": proj_b["id"], "kind": "relates-to"},
        headers=guest_h,
    )
    assert r.status_code == 403, r.text
