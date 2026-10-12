# 04: Board plus hierarchy plus period write

**What to build:** As a user I can manage Tasks, Subtasks 1.1, and Microtasks 1.1.1 on a Kanban board and drag cards between Statuses, so that Status changes record dated periods and history.

**Blocked by:** 02 (projects-directory), 03 (templates-status-profiles).

**Status:** done

- [x] Hierarchy depth capped at Task then 1.1 then 1.1.1 leaf, same Project only; minimum on create is name plus start date plus Status
- [x] Cards show code, priority, dates, subtask preview, tags, assignees, estimate versus spent, blocked pill with dependency link
- [x] Drag-drop upserts the per-Status start, planned due, and actual end dates plus writes history; blocked tasks show the blocked treatment and connector; search, depth, and blocked-only filters work

## Comments

- Slice 4 implemented: backend hierarchy/period/blocked-map seams were already green (T4). Frontend Board cards now show WBS code via shared `boardCard` seam, blocked pill plus per-dependency link buttons opening the edit dialog, and drag-drop sends dated `start_date` so periods record history. Filters (search/depth/blocked-only) via shared TaskFilters already worked. mypy clean, tsc clean, backend 95 passed, frontend 44 passed (incl. new boardCard seam test).
