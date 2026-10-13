# 02: First-Status auto-migrate plus drag picker

**What to build:** As an Owner adding the first Status under a previously-empty assigned Stage, existing Tasks on that Stage move to the new Status without split-brain, and Board drags onto grouped Stages always resolve to an explicit leaf Status.

**Blocked by:** 01 (Empty Stage directly assignable core).

**Status:** implemented

- [x] Adding the first Status under an assigned empty Stage auto-migrates those Tasks to the first Status and writes a `status-migrated` history entry
- [x] After migration the invariant holds: a Task sits on exactly one assignable node and no non-empty Stage is directly assigned
- [x] Board Standard view drag onto a non-empty Stage column forces a Status picker instead of silently picking the first Status
- [x] Filtered/partial views cannot trigger migration or remap

## Comments

- Verified implemented: backend `_auto_migrate_stage_tasks` + `status-migrated` history, Kanban confirm modal always shows the Status picker (never silent first-Status move). `test_first_status_auto_migrate.py` green; full suites backend 129/129, frontend 73/73.
