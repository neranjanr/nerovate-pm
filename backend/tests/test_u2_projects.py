"""U2 seam tests: Projects under Category + scoped code + migration.

Seams under test (SPEC-v0.3 4.2 + ticket U2):
  1. POST /projects {category_id,...} + GET /projects?category_id= filter
  2. Scoped uniques: same code/name in two Categories OK, twice in one Category 422
  3. Migration: old rows without category_id get backfilled Category CAT-<CODE>
     and stay reachable; status_profile_id column retained (unused).
  4. Access: POST requires parent-Category membership or global admin/manager.
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


def _make_category(client: TestClient, headers, name: str) -> dict:
    r = client.post("/api/v1/categories", json={"name": name}, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


def test_scoped_code_and_name_ok_across_categories_dup_422_within(
    client: TestClient, admin_token_headers
):
    cat_a = _make_category(client, admin_token_headers, "U2 Procurements")
    cat_b = _make_category(client, admin_token_headers, "U2 OPEX Items")

    r = client.post(
        "/api/v1/projects",
        json={"name": "Buy server", "code": "SRV-01", "category_id": cat_a["id"]},
        headers=admin_token_headers,
    )
    assert r.status_code == 201, r.text
    assert r.json()["category_id"] == cat_a["id"]

    # Same code + name in a different Category is OK.
    r = client.post(
        "/api/v1/projects",
        json={"name": "Buy server", "code": "SRV-01", "category_id": cat_b["id"]},
        headers=admin_token_headers,
    )
    assert r.status_code == 201, r.text

    # Twice in one Category -> 422 (code clash).
    r = client.post(
        "/api/v1/projects",
        json={"name": "Other name", "code": "SRV-01", "category_id": cat_a["id"]},
        headers=admin_token_headers,
    )
    assert r.status_code == 422, r.text

    # Twice in one Category -> 422 (name clash).
    r = client.post(
        "/api/v1/projects",
        json={"name": "Buy server", "code": "SRV-02", "category_id": cat_a["id"]},
        headers=admin_token_headers,
    )
    assert r.status_code == 422, r.text


def test_list_filter_by_category_and_category_projects_endpoint(
    client: TestClient, admin_token_headers
):
    cat_a = _make_category(client, admin_token_headers, "U2 Cat Filter A")
    cat_b = _make_category(client, admin_token_headers, "U2 Cat Filter B")
    for code in ("FLT-01", "FLT-02"):
        r = client.post(
            "/api/v1/projects",
            json={"name": f"Proj {code}", "code": code, "category_id": cat_a["id"]},
            headers=admin_token_headers,
        )
        assert r.status_code == 201, r.text
    r = client.post(
        "/api/v1/projects",
        json={"name": "Proj FLT-03", "code": "FLT-03", "category_id": cat_b["id"]},
        headers=admin_token_headers,
    )
    assert r.status_code == 201, r.text

    r = client.get(f"/api/v1/projects?category_id={cat_a['id']}", headers=admin_token_headers)
    assert r.status_code == 200, r.text
    codes = sorted(p["code"] for p in r.json())
    assert codes == ["FLT-01", "FLT-02"]

    r = client.get(f"/api/v1/categories/{cat_a['id']}/projects", headers=admin_token_headers)
    assert r.status_code == 200, r.text
    assert sorted(p["code"] for p in r.json()) == ["FLT-01", "FLT-02"]


def test_post_requires_parent_category_membership_or_manager(
    client: TestClient, admin_token_headers
):
    cat = _make_category(client, admin_token_headers, "U2 Gated Cat")
    member_id = _make_user(client, admin_token_headers, "u2member", "member")
    outsider_id = _make_user(client, admin_token_headers, "u2outsider", "member")
    assert outsider_id != member_id

    # Category member (global member role) can create in that Category.
    r = client.post(
        f"/api/v1/categories/{cat['id']}/members",
        json={"user_id": member_id, "role": "member"},
        headers=admin_token_headers,
    )
    assert r.status_code == 201, r.text
    member_h = {"Authorization": f"Bearer {_login(client, 'u2member', 'pass12345')}"}
    r = client.post(
        "/api/v1/projects",
        json={"name": "Member proj", "code": "MBR-01", "category_id": cat["id"]},
        headers=member_h,
    )
    assert r.status_code == 201, r.text

    # Global member without category membership cannot create there (no enumeration).
    outsider_h = {"Authorization": f"Bearer {_login(client, 'u2outsider', 'pass12345')}"}
    r = client.post(
        "/api/v1/projects",
        json={"name": "Outsider proj", "code": "OUT-01", "category_id": cat["id"]},
        headers=outsider_h,
    )
    assert r.status_code == 404, r.text


def test_migration_backfills_category_for_legacy_rows(client: TestClient, admin_token_headers):
    # Simulate a pre-U2 row: insert directly with NULL category_id.
    from sqlmodel import Session

    from app import db as db_module
    from app.projects.models import Project

    with Session(db_module.engine) as session:
        legacy = Project(name="Legacy Proj", code="LGY-01", description="", owner_id=None)
        # Pre-U2 rows have no category; model default keeps it NULL here.
        if "category_id" in Project.model_fields:
            legacy.category_id = None  # type: ignore[attr-defined]
        session.add(legacy)
        session.commit()
        session.refresh(legacy)
        legacy_id = legacy.id
    assert legacy_id is not None

    db_module.init_db()  # additive migration: backfill CAT-LGY-01, then constrain

    r = client.get(f"/api/v1/projects/{legacy_id}", headers=admin_token_headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["code"] == "LGY-01"
    assert body.get("category_id") is not None
    # status_profile_id column retained for back-compat (unused, may be null).
    assert "status_profile_id" in body
