# UI Map v0.2 — `sampleui.html` → routes → APIs → ticket slices

Source of truth for layout: `sampleui.html` (5 `DOCTYPE` pages). SPEC-v0.2 §5 is the contract; this file is the build index. No new views may be invented outside these five.

## Page index

### Page 1 — Execution Timeline + WBS Inspector → `GET /projects/{id}/timeline` (default landing)
Sample anchors: `PROJECT CONTEXT & BREADCRUMB STRIP`, `STAGE & WORKFLOW PROGRESSION PIPELINE`, `MAIN EXECUTION TIMELINE SPLIT WORKSPACE`, `LEFT PANE: WBS & RACI INSPECTOR TABLE`, `RIGHT PANE: TIMELINE GANTT & STATUS PERIOD SEGMENTS`, `BOTTOM DRAWER / INSPECTOR CARD`, `Status Periods Upsert Log (SPEC-v0.2 Section 4.4 compliant)`.
Binds: `GET /tasks/timeline?project_id=`, `GET /tasks/{id}/history`. Depth rows 0 / 1.1 / 1.1.1, stacked per-Status bars, Today line, SVG dependency connectors. Ticket: T5 (blocked by T4).

### Page 2 — Projects Directory → `GET /projects`
Sample anchors: `Projects Directory`, project cards/table, search + create. Binds: `CRUD /projects`, `CRUD /projects/{id}/members`. Membership-filtered, 404 on non-member. Ticket: T2 (blocked by T1).

### Page 3 — Kanban Board + Task Hierarchy → `GET /projects/{id}/board`
Sample anchors: `Kanban Board & Task Hierarchy`, `COLUMN 1: Get Prior Approval`, `COLUMN 2: Prepare Quotes`, `COLUMN 3: Evaluation`, `COLUMN 4: Closed`, `Nested Subtask & Microtask Hierarchy Branch`, `Microtask child`, `Blocked Highlight`, `Hours / Estimate vs Spent Tracker`.
Binds: `GET /tasks?project_id=&depth=&blocked=&search=`, `POST /tasks/{id}/status`, `GET /tasks/blocked-map`. Drag-drop writes period + history. Ticket: T4 (blocked by T2, T3).

### Page 4 — Metrics Dashboard + Workload → `GET /projects/{id}/dashboard`
Sample anchors: `Metrics Dashboard & Workload`, `KPI SUMMARY CARDS: 5 Columns Grid (GET /api/v1/dashboard/summary)`, `Team Capacity Rows`, `AUDIT & EVENT DISPATCH STREAM`, `On-Prem Storage & Backup Card`.
Binds: `GET /dashboard/summary?project_id=`, events `task.status_changed`, `task.comment_added`. Workload hidden from member/guest per §3 matrix. Ticket: T7 (blocked by T5).

### Page 5 — Task Drawer slide-over → overlay `/projects/{id}/tasks/{taskId}`
Sample anchors: `Task Drawer & Execution Timeline`, `DRAWER MAIN CONTAINER`, `TITLE & WHOLE PROCESS INITIATION BANNER`, `STATUS PERIOD EXECUTION BOX (SPEC-v0.2 Section 4.4 & 4.5)`, `METADATA GRID & SYSTEM CUSTOM FIELDS`, `HIERARCHY TREE (DEPTH 0 > DEPTH 1 > DEPTH 2 MICROTASK)`, `TABBED LOWER SECTION (COMMENTS, ATTACHMENTS, AUDIT)`, `FIXED DRAWER FOOTER CONTROLS`.
Binds: `CRUD /tasks`, `POST /tasks/{id}/status`, `POST /tasks/{id}/comments`, `GET /tasks/{id}/history`, attachments (10MB). Whole-process start separate from Status dates. Ticket: T6 (blocked by T4).

## Shared chrome (all pages)
Breadcrumb `Project code > Title` + badges + tab bar `Board | List | Calendar | Table | Execution Timeline | Dashboard | Workload | Settings` gated by §3 matrix via `modules/registry.ts {id, route, navLabel, requiredRole}`. Ticket: T1 (blocks all), T8 for List/Calendar/Table/Settings parity.

## How to cut tickets from here
Each T1–T9 in SPEC §8 is one vertical slice: schema + API + sample-page UI + test. Slice acceptance = the Acceptance line under each §5 entry. Next step is the ticket breakdown quiz, then publish one file per ticket. Calendar/Table/Settings reuse P2/P3 components — no separate schema work.
