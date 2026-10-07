import os
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel, create_engine
from sqlmodel.pool import StaticPool

os.environ.setdefault("JWT_SECRET", "test-secret-for-t1-min-32-bytes-long-xxxx")


@pytest.fixture()
def client(monkeypatch):
    """Fresh in-memory app per test module run."""
    from app import db as db_module
    from app.main import create_app

    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    monkeypatch.setattr(db_module, "engine", engine)

    db_module.init_db()

    # Default admin (admin/admin) is seeded by init_db; nothing extra to do here.

    app = create_app()
    with TestClient(app) as c:
        yield c


@pytest.fixture()
def admin_user(client: TestClient):
    return {"username": "admin"}


def _auth_headers(client: TestClient, username: str, password: str):
    r = client.post("/api/v1/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture()
def admin_token_headers(client: TestClient):
    return _auth_headers(client, "admin", "admin")


def _create_user(client: TestClient, headers, username: str, role: str):
    r = client.post(
        "/api/v1/users",
        json={"username": username, "password": "pass12345", "name": username, "role": role},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()


@pytest.fixture()
def member_token_headers(client: TestClient, admin_token_headers):
    _create_user(client, admin_token_headers, "member0", "member")
    return _auth_headers(client, "member0", "pass12345")


@pytest.fixture()
def seeded_projects(client: TestClient, admin_token_headers):
    """Alpha (member1+guest1) and Beta (nobody except admin/owner) projects."""
    h = admin_token_headers
    _create_user(client, h, "member1", "member")
    _create_user(client, h, "guest1", "guest")
    _create_user(client, h, "outsider", "member")

    def _project(code: str, name: str):
        r = client.post("/api/v1/projects", json={"name": name, "code": code}, headers=h)
        assert r.status_code == 201, r.text
        return r.json()["id"]

    alpha_id = _project("PRC-01", "Alpha")
    beta_id = _project("PRC-02", "Beta")

    # look up user ids
    r = client.get("/api/v1/users", headers=h)
    users = {u["username"]: u["id"] for u in r.json()}
    for username in ["member1", "guest1"]:
        r = client.post(
            f"/api/v1/projects/{alpha_id}/members",
            json={"user_id": users[username], "role": "member" if username == "member1" else "guest"},
            headers=h,
        )
        assert r.status_code == 201, r.text
    return {"client": client, "alpha_id": alpha_id, "beta_id": beta_id}
