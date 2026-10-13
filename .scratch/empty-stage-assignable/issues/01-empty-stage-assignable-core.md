# 01: Empty Stage directly assignable core

**What to build:** As a team member I can set a Task, Subtask, or Microtask directly onto an empty Status Stage (zero Statuses), and I cannot set one directly onto a non-empty Stage.

**Blocked by:** None (can start immediately).

**Status:** implemented

- [x] Status dropdown groups by Stage: empty Stages render as selectable rows, non-empty Stages as disabled headers with only their leaf Statuses selectable
- [x] API rejects direct Stage assignment when `status_count > 0`; empty-Stage assignment renders at 100% with `●` glyph per ADR-0010
- [x] Stage editor offers an optional guided "create matching Status" action; nothing auto-creates on assignment
- [x] Derivation, shade cascade, and delete/remap rules from ADR-0005 stay green

## Comments

- Verified implemented: backend `stage_id` validation + `empty_stage_signal()` 100%/●, `TaskDialog`/`TaskDrawer` grouped dropdown (empty Stages as selectable options, non-empty as disabled optgroups), "+ Create matching Status" in `GlobalSettings`, rendering in Board/Kanban/List/Dashboard/MindMap. `test_empty_stage_assignable.py` green; full suites backend 129/129, frontend 73/73.
