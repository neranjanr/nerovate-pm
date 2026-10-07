"""U7 seam tests: Nerovate-PM rebrand + db migration.

Seams under test (SPEC-v0.3 2 + ticket U7):
  1. migrate_legacy_db copies nrg.db -> nerovate.db on first boot when target missing.
  2. FastAPI title is "Nerovate-PM".
"""

import os
from fastapi.testclient import TestClient


def test_app_title_is_nerovate_pm(client: TestClient):
    # TestClient doesn't expose app directly unless imported from app.main
    from app.main import app
    assert app.title == "Nerovate-PM"


def test_migrate_legacy_db_copies_file(tmp_path):
    from app.db import migrate_legacy_db

    target = tmp_path / "nerovate.db"
    legacy = tmp_path / "nrg.db"
    legacy.write_text("dummy legacy sqlite bytes")

    assert not target.exists()
    copied = migrate_legacy_db(target_url=f"sqlite:///{target}", source_path=str(legacy))
    assert copied is True
    assert target.exists()
    assert target.read_text() == "dummy legacy sqlite bytes"

    # Subsequent run when target exists does not copy again.
    copied_again = migrate_legacy_db(target_url=f"sqlite:///{target}", source_path=str(legacy))
    assert copied_again is False
