"""U1 seam tests: Categories + hybrid membership.

Seams under test (SPEC-v0.3 4.1 + ticket U1):
  1. HTTP API seam: CRUD /api/v1/categories
  2. HTTP membership seam: CRUD /categories/{id}/members, GET /categories/{id}/projects
  3. Access seam: union (category u project), role=max, 404 non-member;
     POST /categories requires admin/manager; guest sees member Categories only.
  4. Rename keeps key (key immutable).
"""

from fastapi.testclient import TestClient


def _login(client: TestClient, username: str, password: str) -> str:
    r = client.post("/api/v1/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def _make_user(client: TestClient, headers, username: str, role: str) -> int:
    r = client.post(
        "/api/v1/users",
        json={"username": username, "password": "pass12345", "name": username, "role": role},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


def test_create_and_rename_keeps_key(client: TestClient, admin_token_headers):
    r = client.post(
        "/api/v1/categories",
        json={"name": "Procurements", "color": "#6b7280"},
        headers=admin_token_headers,
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["name"] == "Procurements"
    assert body["key"].startswith("CAT-")
    key = body["key"]
    cid = body["id"]

    r = client.patch(
        f"/api/v1/categories/{cid}",
        json={"name": "Procurements Renamed"},
        headers=admin_token_headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["name"] == "Procurements Renamed"
    assert r.json()["key"] == key


def test_category_name_globally_unique(client: TestClient, admin_token_headers):
    r = client.post("/api/v1/categories", json={"name": "OPEX Items"}, headers=admin_token_headers)
    assert r.status_code == 201, r.text
    r = client.post("/api/v1/categories", json={"name": "OPEX Items"}, headers=admin_token_headers)
    assert r.status_code == 409


def test_post_categories_requires_manager(client: TestClient, admin_token_headers):
    _make_user(client, admin_token_headers, "u1member", "member")
    token = _login(client, "u1member", "pass12345")
    h = {"Authorization": f"Bearer {token}"}
    r = client.post("/api/v1/categories", json={"name": "Nope"}, headers=h)
    assert r.status_code == 403


def test_guest_sees_member_categories_only(client: TestClient, admin_token_headers):
    guest_id = _make_user(client, admin_token_headers, "u1guest", "guest")
    r = client.post("/api/v1/categories", json={"name": "Cat A"}, headers=admin_token_headers)
    assert r.status_code == 201, r.text
    cat_a = r.json()["id"]
    r = client.post("/api/v1/categories", json={"name": "Cat B"}, headers=admin_token_headers)
    assert r.status_code == 201, r.text
    cat_b = r.json()["id"]

    r = client.post(
        f"/api/v1/categories/{cat_a}/members",
        json={"user_id": guest_id, "role": "guest"},
        headers=admin_token_headers,
    )
    assert r.status_code == 201, r.text

    token = _login(client, "u1guest", "pass12345")
    h = {"Authorization": f"Bearer {token}"}
    r = client.get("/api/v1/categories", headers=h)
    assert r.status_code == 200, r.text
    ids = [c["id"] for c in r.json()]
    assert cat_a in ids
    assert cat_b not in ids

    # non-member fetch returns 404, not 403
    r = client.get(f"/api/v1/categories/{cat_b}", headers=h)
    assert r.status_code == 404


def test_category_members_crud_and_projects_endpoint(client: TestClient, admin_token_headers):
    uid = _make_user(client, admin_token_headers, "u1m2", "member")
    r = client.post("/api/v1/categories", json={"name": "Cat C"}, headers=admin_token_headers)
    cid = r.json()["id"]

    r = client.post(
        f"/api/v1/categories/{cid}/members",
        json={"user_id": uid, "role": "member"},
        headers=admin_token_headers,
    )
    assert r.status_code == 201, r.text

    r = client.get(f"/api/v1/categories/{cid}/members", headers=admin_token_headers)
    assert r.status_code == 200, r.text
    assert any(m["user_id"] == uid for m in r.json())

    r = client.get(f"/api/v1/categories/{cid}/projects", headers=admin_token_headers)
    assert r.status_code == 200, r.text
    assert isinstance(r.json(), list)

    r = client.delete(f"/api/v1/categories/{cid}/members/{uid}", headers=admin_token_headers)
    assert r.status_code == 204, r.text
