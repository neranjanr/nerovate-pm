"""Status Weight / Glyph / Kind seam tests (status-glyph-weight spec).

Seam under test: one pure derivation function of
(index, sibling count, kind, is_done) -> (glyph, percent),
mirrored on both sides of the stack.
"""

import pytest
from fastapi.testclient import TestClient

from app.statuses.signals import (
    KIND_LABELS,
    STATUS_KINDS,
    derive_status_signal,
    normalize_kind,
    stage_average,
    status_glyph,
    status_weight,
)


def test_percent_two_status_stage():
    assert status_weight(0, 2) == 0
    assert status_weight(1, 2) == 100


def test_percent_five_status_stage():
    assert [status_weight(i, 5) for i in range(5)] == [0, 25, 50, 75, 100]


def test_percent_twelve_status_stage():
    weights = [status_weight(i, 12) for i in range(12)]
    assert weights[0] == 0
    assert weights[-1] == 100
    assert weights == sorted(weights)


def test_percent_fifteen_status_stage_steps():
    assert [status_weight(i, 15) for i in range(15)] == [
        0, 7, 14, 21, 29, 36, 43, 50, 57, 64, 71, 79, 86, 93, 100,
    ]


def test_percent_single_status_stage_is_full():
    assert status_weight(0, 1) == 100


def test_normal_glyph_ramp_endpoints():
    assert status_glyph(0, 2) == "○"
    assert status_glyph(1, 2) == "●"


def test_normal_glyph_ramp_monotonic_five():
    assert [status_glyph(i, 5) for i in range(5)] == ["○", "◔", "◑", "◕", "●"]


def test_normal_glyph_ramp_monotonic_fifteen():
    ramp = ["○", "◔", "◑", "◕", "●"]
    glyphs = [status_glyph(i, 15) for i in range(15)]
    assert glyphs[0] == "○"
    assert glyphs[-1] == "●"
    assert [ramp.index(g) for g in glyphs] == sorted(ramp.index(g) for g in glyphs)


def test_kind_overrides_preserve_percent():
    for kind in ("on_hold", "blocked", "attention", "cancelled"):
        glyph, percent = derive_status_signal(3, 5, kind=kind)
        assert percent == 75
        assert glyph != status_glyph(3, 5)


def test_done_forces_check_regardless_of_position():
    assert derive_status_signal(0, 5, is_done=True)[0] == "✓"
    assert derive_status_signal(0, 5, kind="blocked", is_done=True)[0] == "✓"
    # Percent still reflects position.
    assert derive_status_signal(0, 5, is_done=True)[1] == 0


def test_glyphs_are_single_text_plane_chars():
    import unicodedata

    for i in range(15):
        for kind in STATUS_KINDS:
            g, _ = derive_status_signal(i, 15, kind=kind)
            assert len(g) <= 2, g
            for ch in g:
                assert ord(ch) < 0x2600 or unicodedata.category(ch) != "So", ch


def test_unknown_kind_rejected():
    with pytest.raises(ValueError):
        normalize_kind("frozen")


def test_kind_labels_cover_all_kinds():
    for kind in STATUS_KINDS:
        assert KIND_LABELS[kind]
    assert KIND_LABELS["done"]


def test_stage_average_rounds_mean():
    assert stage_average([0, 100]) == 50
    assert stage_average([0, 7, 14]) == 7
    assert stage_average([]) == 0


def _profile_with_stage(client: TestClient, h, name: str = "Sig") -> tuple[int, int]:
    r = client.post("/api/v1/status-profiles", json={"name": name}, headers=h)
    assert r.status_code == 201, r.text
    pid = r.json()["id"]
    r = client.post(
        f"/api/v1/status-profiles/{pid}/stages",
        json={"name": "S1", "color_base": "#3b82f6"},
        headers=h,
    )
    assert r.status_code == 201, r.text
    return pid, r.json()["id"]


def test_kind_defaults_normal_and_persists(client: TestClient, admin_token_headers):
    h = admin_token_headers
    pid, sid = _profile_with_stage(client, h)
    r = client.post(f"/api/v1/stages/{sid}/statuses", json={"name": "A"}, headers=h)
    assert r.status_code == 201, r.text
    assert r.json()["kind"] == "normal"
    status_id = r.json()["id"]
    r = client.put(
        f"/api/v1/status-profiles/{pid}/statuses/{status_id}",
        json={"kind": "blocked"},
        headers=h,
    )
    assert r.status_code == 200, r.text
    assert r.json()["kind"] == "blocked"
    r = client.get(f"/api/v1/status-profiles/{pid}", headers=h)
    assert r.status_code == 200, r.text
    assert next(s for s in r.json()["statuses"] if s["id"] == status_id)["kind"] == "blocked"


def test_unknown_kind_rejected_by_api(client: TestClient, admin_token_headers):
    h = admin_token_headers
    pid, sid = _profile_with_stage(client, h, name="SigBad")
    r = client.post(
        f"/api/v1/stages/{sid}/statuses", json={"name": "A", "kind": "frozen"}, headers=h
    )
    assert r.status_code == 422, r.text


def test_legacy_blocked_backfills_to_blocked_kind(
    client: TestClient, admin_token_headers
):
    h = admin_token_headers
    pid, sid = _profile_with_stage(client, h, name="SigLegacy")
    r = client.post(
        f"/api/v1/stages/{sid}/statuses",
        json={"name": "Old", "is_blocked": True},
        headers=h,
    )
    assert r.status_code == 201, r.text
    assert r.json()["kind"] == "blocked"


def test_reorder_preserves_kind(client: TestClient, admin_token_headers):
    h = admin_token_headers
    pid, sid = _profile_with_stage(client, h, name="SigReorder")
    ids = []
    for name in ("A", "B", "C"):
        r = client.post(f"/api/v1/stages/{sid}/statuses", json={"name": name}, headers=h)
        assert r.status_code == 201, r.text
        ids.append(r.json()["id"])
    r = client.put(
        f"/api/v1/status-profiles/{pid}/statuses/{ids[2]}",
        json={"kind": "on_hold"},
        headers=h,
    )
    assert r.status_code == 200, r.text
    # Swap first and last via order rewrite.
    for status_id, order in ((ids[2], 1), (ids[1], 2), (ids[0], 3)):
        r = client.put(
            f"/api/v1/status-profiles/{pid}/statuses/{status_id}",
            json={"order": order},
            headers=h,
        )
        assert r.status_code == 200, r.text
    r = client.get(f"/api/v1/status-profiles/{pid}", headers=h)
    assert r.status_code == 200, r.text
    kinds = {s["id"]: s["kind"] for s in r.json()["statuses"]}
    assert kinds[ids[2]] == "on_hold"
    assert kinds[ids[0]] == "normal"


def test_clone_preserves_kind(client: TestClient, admin_token_headers):
    h = admin_token_headers
    pid, sid = _profile_with_stage(client, h, name="SigClone")
    r = client.post(f"/api/v1/stages/{sid}/statuses", json={"name": "A"}, headers=h)
    assert r.status_code == 201, r.text
    status_id = r.json()["id"]
    r = client.put(
        f"/api/v1/status-profiles/{pid}/statuses/{status_id}",
        json={"kind": "attention"},
        headers=h,
    )
    assert r.status_code == 200, r.text
    r = client.post(f"/api/v1/status-profiles/{pid}/clone", headers=h)
    assert r.status_code == 201, r.text
    kinds = [s["kind"] for s in r.json()["statuses"]]
    assert kinds == ["attention"]


def test_apply_template_preserves_kind(client: TestClient, admin_token_headers):
    h = admin_token_headers
    pid, sid = _profile_with_stage(client, h, name="SigTemplate")
    r = client.post(
        f"/api/v1/stages/{sid}/statuses", json={"name": "A", "kind": "cancelled"}, headers=h
    )
    assert r.status_code == 201, r.text
    r = client.post(
        "/api/v1/projects",
        json={"name": "Sig Project", "code": "SIG-01", "start_date": "2026-03-01"},
        headers=h,
    )
    assert r.status_code == 201, r.text
    proj_id = r.json()["id"]
    r = client.post(f"/api/v1/projects/{proj_id}/apply-profile/{pid}", headers=h)
    assert r.status_code == 200, r.text
    applied_id = r.json()["status_profile_id"]
    r = client.get(f"/api/v1/status-profiles/{applied_id}", headers=h)
    assert r.status_code == 200, r.text
    kinds = [s["kind"] for s in r.json()["statuses"]]
    assert kinds == ["cancelled"]
