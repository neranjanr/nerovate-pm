"""T3 tests: Templates plus Status Profiles P3.

Seams under test:
  1. Status Profile CRUD plus ordered Statuses with done and blocked flags; clone-as-template works.
  2. Applying a Template copies Statuses plus field definitions into the Project.
  3. Seed content covers procurement flow and monthly repetitive flow.
"""

from fastapi.testclient import TestClient


def test_seeded_templates(client: TestClient, admin_token_headers):
    r = client.get("/api/v1/status-profiles", headers=admin_token_headers)
    assert r.status_code == 200, r.text
    profiles = r.json()
    assert len(profiles) >= 2

    names = [p["name"] for p in profiles]
    assert "Procurement" in names
    assert "Monthly Repetitive" in names

    proc = next(p for p in profiles if p["name"] == "Procurement")
    assert proc["is_template"] is True
    assert len(proc["statuses"]) == 4
    status_names = [s["name"] for s in proc["statuses"]]
    assert status_names == ["Get prior approval", "Prepare quotes", "Evaluation", "Closed"]
    assert proc["statuses"][-1]["is_done"] is True

    monthly = next(p for p in profiles if p["name"] == "Monthly Repetitive")
    assert monthly["is_template"] is True
    assert len(monthly["statuses"]) == 4
    m_names = [s["name"] for s in monthly["statuses"]]
    assert m_names == ["Due", "Paid", "Verified", "Closed"]
    assert monthly["statuses"][-1]["is_done"] is True


def test_status_profile_crud_and_statuses(client: TestClient, admin_token_headers):
    # Create new status profile
    r = client.post(
        "/api/v1/status-profiles",
        json={"name": "Custom Workflow", "is_template": True},
        headers=admin_token_headers,
    )
    assert r.status_code == 201, r.text
    profile = r.json()
    pid = profile["id"]
    assert profile["name"] == "Custom Workflow"

    # Add status
    r = client.post(
        f"/api/v1/status-profiles/{pid}/statuses",
        json={"name": "Review", "color": "#123456", "order": 1, "is_done": False, "is_blocked": False},
        headers=admin_token_headers,
    )
    assert r.status_code == 201, r.text
    status_data = r.json()
    sid = status_data["id"]
    assert status_data["name"] == "Review"

    # Update status
    r = client.put(
        f"/api/v1/status-profiles/{pid}/statuses/{sid}",
        json={"name": "Final Review", "is_blocked": True},
        headers=admin_token_headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["name"] == "Final Review"
    assert r.json()["is_blocked"] is True

    # Add custom field def
    r = client.post(
        f"/api/v1/status-profiles/{pid}/custom-field-defs",
        json={"key": "urgency", "type": "dropdown", "label": "Urgency Level", "required": True, "order": 1},
        headers=admin_token_headers,
    )
    assert r.status_code == 201, r.text
    cf = r.json()
    cf_id = cf["id"]
    assert cf["key"] == "urgency"

    # Clone profile
    r = client.post(f"/api/v1/status-profiles/{pid}/clone", headers=admin_token_headers)
    assert r.status_code == 201, r.text
    clone_data = r.json()
    assert clone_data["name"] == "Custom Workflow (Clone)"
    assert len(clone_data["statuses"]) == 1
    assert len(clone_data["custom_field_defs"]) == 1

    # Delete status and custom field def
    r = client.delete(f"/api/v1/status-profiles/{pid}/statuses/{sid}", headers=admin_token_headers)
    assert r.status_code == 204

    r = client.delete(f"/api/v1/status-profiles/{pid}/custom-field-defs/{cf_id}", headers=admin_token_headers)
    assert r.status_code == 204

    # Delete profile
    r = client.delete(f"/api/v1/status-profiles/{pid}", headers=admin_token_headers)
    assert r.status_code == 204


def test_apply_template_to_project(client: TestClient, admin_token_headers):
    # Get procurement template id
    r = client.get("/api/v1/status-profiles", headers=admin_token_headers)
    profiles = r.json()
    proc = next(p for p in profiles if p["name"] == "Procurement")

    # Create project
    r = client.post(
        "/api/v1/projects",
        json={"name": "Procurement Project", "code": "PRC-PROJ", "start_date": "2026-03-01"},
        headers=admin_token_headers,
    )
    assert r.status_code == 201, r.text
    proj = r.json()
    proj_id = proj["id"]
    assert proj["status_profile_id"] is None

    # Apply procurement template
    r = client.post(f"/api/v1/projects/{proj_id}/apply-profile/{proc['id']}", headers=admin_token_headers)
    assert r.status_code == 200, r.text
    updated_proj = r.json()
    assert updated_proj["status_profile_id"] is not None

    # Verify project status profile has statuses and custom fields copied
    r = client.get(f"/api/v1/status-profiles/{updated_proj['status_profile_id']}", headers=admin_token_headers)
    assert r.status_code == 200
    p_detail = r.json()
    assert len(p_detail["statuses"]) == 4
    assert len(p_detail["custom_field_defs"]) >= 1
    assert p_detail["is_template"] is False
