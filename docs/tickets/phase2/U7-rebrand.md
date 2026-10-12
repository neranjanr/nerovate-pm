# U7 — Nerovate-PM rebrand + migration

Rename per SPEC-v0.3 §2 (compose, Dockerfiles, `db.py`, `dashboard/service.py`, `main.py` title, `package.json`s, `index.html`, `auth.tsx`, `theme.tsx`, `Login.tsx`, `start-service.ps1`, docs headers). DB: copy `nrg.db→nerovate.db` on boot if missing. Frontend: write `nv_*`, dual-read `nrg_*` fallback. Keep `/api/v1`, keep repo folder.
Acceptance: fresh boot uses `nerovate.db`; old `nrg.db` migrated; old localStorage session still logs in; Login shows Nerovate-PM.
Blocked-by: U1. Blocks: none.
