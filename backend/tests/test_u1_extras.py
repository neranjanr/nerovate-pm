"""Additional U1 union visibility and profile unset tests."""

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


def test_category_profile_unset(client: TestClient, admin_token_headers):
    # create profile
    r = client.post("/api/v1/status-profiles", json={"name": "Prof A"}, headers=admin_token_headers)
    assert r.status_code == 201
    pid = r.json()["id"]

    r = client.post(
        "/api/v1/categories",
        json={"name": "Cat Profiled", "status_profile_id": pid},
        headers=admin_token_headers,
    )
    assert r.status_code == 201
    cid = r.json()["id"]
    assert r.json()["status_profile_id"] == pid

    # unset profile
    r = client.patch(
        f"/api/v1/categories/{cid}",
        json={"status_profile_id": None},
        headers=admin_token_headers,
    )
    assert r.status_code == 200
    assert r.json()["status_profile_id"] is None
