"""T9 tests: Export + polish.

Seams under test:
  1. GET /api/v1/tasks/timeline?project_id=&depth= filters by depth (0/1/2).
  2. GET /api/v1/tasks/timeline/export?project_id=&format=json|csv honours
     depth filter, membership gate (outsider 404) and timeline view gate
     (guest 403); invalid format 400.
  3. GET /api/v1/dashboard/export?project_id=&format=json|csv returns the
     report bundle; guest 403, member gets JSON with empty workload but 403
     on CSV workload export, outsider 404.
"""

from fastapi.testclient import TestClient


def _setup(client: TestClient, headers):
    r = client.post(
        "/api/v1/status-profiles",
        json={"name": "T9 Profile", "is_template": True},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    profile_id = r.json()["id"]
    for idx, name in enumerate(["Todo", "Done"]):
        r = client.post(
            f"/api/v1/status-profiles/{profile_id}/statuses",
            json={"name": name, "order": idx, "is_done": name == "Done"},
            headers=headers,
        )
        assert r.status_code == 201, r.text
    r = client.post(
        "/api/v1/projects",
        json={"name": "T9 Project", "code": "T9P-01", "start_date": "2026-06-01"},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    proj_id = r.json()["id"]
    r = client.post(f"/api/v1/projects/{proj_id}/apply-profile/{profile_id}", headers=headers)
    assert r.status_code == 200, r.text
    r = client.get(f"/api/v1/projects/{proj_id}", headers=headers)
    sp_id = r.json()["status_profile_id"]
    r = client.get(f"/api/v1/status-profiles/{sp_id}", headers=headers)
    statuses = {s["name"]: s["id"] for s in r.json()["statuses"]}
    return proj_id, statuses


def _mkuser(client: TestClient, headers, username: str, role: str):
    r = client.post(
        "/api/v1/users",
        json={"username": username, "password": "pass12345", "name": username, "role": role},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    uid = r.json()["id"]
    r = client.post("/api/v1/auth/login", json={"username": username, "password": "pass12345"})
    assert r.status_code == 200, r.text
    return uid, {"Authorization": f"Bearer {r.json()['access_token']}"}


def _seed_hierarchy(client: TestClient, h, proj_id, statuses):
    r = client.post(
        "/api/v1/tasks",
        json={
            "project_id": proj_id,
            "title": "Root export",
            "start_date": "2026-06-01",
            "due_date": "2026-06-10",
            "status_id": statuses["Todo"],
        },
        headers=h,
    )
    assert r.status_code == 201, r.text
    root_id = r.json()["id"]
    r = client.post(
        "/api/v1/tasks",
        json={
            "project_id": proj_id,
            "title": "Child 1.1",
            "start_date": "2026-06-02",
            "status_id": statuses["Todo"],
            "parent_id": root_id,
        },
        headers=h,
    )
    assert r.status_code == 201, r.text
    sub_id = r.json()["id"]
    r = client.post(
        "/api/v1/tasks",
        json={
            "project_id": proj_id,
            "title": "Micro 1.1.1",
            "start_date": "2026-06-03",
            "status_id": statuses["Todo"],
            "parent_id": sub_id,
        },
        headers=h,
    )
    assert r.status_code == 201, r.text
    micro_id = r.json()["id"]
    return root_id, sub_id, micro_id


def test_timeline_depth_filter(client: TestClient, admin_token_headers):
    h = admin_token_headers
    proj_id, statuses = _setup(client, h)
    root_id, sub_id, micro_id = _seed_hierarchy(client, h, proj_id, statuses)

    r = client.get(f"/api/v1/tasks/timeline?project_id={proj_id}", headers=h)
    assert r.status_code == 200, r.text
    assert {i["task_id"] for i in r.json()} >= {root_id, sub_id, micro_id}

    r = client.get(f"/api/v1/tasks/timeline?project_id={proj_id}&depth=0", headers=h)
    assert r.status_code == 200, r.text
    got = r.json()
    assert {i["task_id"] for i in got} == {root_id}
    assert all(i["depth"] == 0 for i in got)

    r = client.get(f"/api/v1/tasks/timeline?project_id={proj_id}&depth=2", headers=h)
    assert [i["task_id"] for i in r.json()] == [micro_id]


def test_timeline_export_json_csv_gating(client: TestClient, admin_token_headers):
    h = admin_token_headers
    proj_id, statuses = _setup(client, h)
    root_id, _sub, micro_id = _seed_hierarchy(client, h, proj_id, statuses)

    member_id, member_h = _mkuser(client, h, "t9member", "member")
    guest_id, guest_h = _mkuser(client, h, "t9guest", "guest")
    for uid, role in [(member_id, "member"), (guest_id, "guest")]:
        r = client.post(
            f"/api/v1/projects/{proj_id}/members",
            json={"user_id": uid, "role": role},
            headers=h,
        )
        assert r.status_code == 201, r.text

    # JSON export honours depth filter
    r = client.get(f"/api/v1/tasks/timeline/export?project_id={proj_id}&format=json", headers=h)
    assert r.status_code == 200, r.text
    assert {i["task_id"] for i in r.json()} >= {root_id, micro_id}
    r = client.get(
        f"/api/v1/tasks/timeline/export?project_id={proj_id}&format=json&depth=2",
        headers=h,
    )
    assert [i["task_id"] for i in r.json()] == [micro_id]

    # CSV export has header + rows and disposition
    r = client.get(f"/api/v1/tasks/timeline/export?project_id={proj_id}&format=csv", headers=member_h)
    assert r.status_code == 200, r.text
    assert "text/csv" in r.headers.get("content-type", "")
    lines = r.text.strip().splitlines()
    assert lines[0].startswith("task_id,title,depth,")
    assert any(str(root_id) in line for line in lines[1:])

    # invalid format
    r = client.get(f"/api/v1/tasks/timeline/export?project_id={proj_id}&format=pdf", headers=h)
    assert r.status_code == 400, r.text

    # guest has no timeline view
    r = client.get(f"/api/v1/tasks/timeline/export?project_id={proj_id}&format=json", headers=guest_h)
    assert r.status_code == 403, r.text

    # outsider gets 404
    _, outsider_h = _mkuser(client, h, "t9outsider", "member")
    r = client.get(f"/api/v1/tasks/timeline/export?project_id={proj_id}&format=json", headers=outsider_h)
    assert r.status_code == 404, r.text


def test_dashboard_export_bundle_and_gating(client: TestClient, admin_token_headers):
    h = admin_token_headers
    proj_id, statuses = _setup(client, h)
    _seed_hierarchy(client, h, proj_id, statuses)

    member_id, member_h = _mkuser(client, h, "t9dashmember", "member")
    guest_id, guest_h = _mkuser(client, h, "t9dashguest", "guest")
    for uid, role in [(member_id, "member"), (guest_id, "guest")]:
        client.post(f"/api/v1/projects/{proj_id}/members", json={"user_id": uid, "role": role}, headers=h)

    # JSON bundle as admin: summary + workload + activity + storage
    r = client.get(f"/api/v1/dashboard/export?project_id={proj_id}&format=json", headers=h)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["project_id"] == proj_id
    assert body["summary"]["total"] == 3
    assert "workload" in body and "activity" in body and "storage" in body

    # JSON bundle as member: KPIs match, workload hidden
    r = client.get(f"/api/v1/dashboard/export?project_id={proj_id}&format=json", headers=member_h)
    assert r.status_code == 200, r.text
    assert r.json()["summary"]["total"] == 3
    assert r.json()["workload"] == []

    # CSV workload export as admin works
    r = client.get(f"/api/v1/dashboard/export?project_id={proj_id}&format=csv", headers=h)
    assert r.status_code == 200, r.text
    assert "text/csv" in r.headers.get("content-type", "")
    assert r.text.strip().splitlines()[0].startswith("user_id,username,")

    # CSV workload export as member is forbidden (manager+ view)
    r = client.get(f"/api/v1/dashboard/export?project_id={proj_id}&format=csv", headers=member_h)
    assert r.status_code == 403, r.text

    # guest has no dashboard view at all
    r = client.get(f"/api/v1/dashboard/export?project_id={proj_id}&format=json", headers=guest_h)
    assert r.status_code == 403, r.text

    # invalid format
    r = client.get(f"/api/v1/dashboard/export?project_id={proj_id}&format=xml", headers=h)
    assert r.status_code == 400, r.text

    # outsider gets 404
    _, outsider_h = _mkuser(client, h, "t9dashoutsider", "member")
    r = client.get(f"/api/v1/dashboard/export?project_id={proj_id}&format=json", headers=outsider_h)
    assert r.status_code == 404, r.text
