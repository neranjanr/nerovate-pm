# NRG Projects — SPEC-v0.2

## 1. Goal
On-prem system for 20 users, Ubuntu + Docker Compose. Modules: Auth, Projects, Status Templates, Tasks / Subtasks / Microtasks, List / Board / Calendar / Table / Dashboard / Workload / Timeline. Future: Gantt, Mindmap, Docs, Email/SMS, Drive-sync without touching working modules.

Industry parity scope for v0.2: standard project-task-subtask management, user-defined Status workflows per Project Template, per-Status periods for execution timeline, custom fields, threaded comments with mentions, workload reporting, view-level access control.

## 2. Stack
Frontend: React + Vite + TS + Tailwind. Backend: FastAPI + SQLModel. DB: SQLite WAL at `/data/nrg.db`. Files: `/data/uploads`. Proxy: Caddy. All APIs under `/api/v1`.

Monorepo layout:
```
/frontend/src/{pages,components,stores,modules/registry.ts}
/backend/app/{auth,users,projects,tasks,statuses,dashboard,files,events.py}
/data/ (sqlite + uploads, docker volume, NOT in git)
docker-compose.yml + Caddyfile
```

## 3. Roles & View Access
Global `role[admin|manager|member|guest]`. MVP auth: username/password + JWT (access 60m + refresh 7d). Admin creates users. Later: TOTP, SSO as new `auth_mfa` module.

- `project_members(project_id, user_id, role)` controls which Projects a User sees. No membership = no access (404, not 403 enumeration).
- Role controls which views/tabs are visible (enforced backend + frontend):

| View | admin | manager | member | guest |
|---|---|---|---|---|
| List, Board | yes | yes | yes | yes (own Projects only, read + comment) |
| Calendar, Table | yes | yes | yes | no |
| Dashboard, Timeline | yes | yes | yes | no |
| Workload | yes | yes | no | no |
| Settings (members, apply template) | yes | yes (own Projects) | no | no |
| Users, Templates admin | yes | no | no | no |

Rule: every list/detail endpoint checks `project membership + role -> allowed views`. Guest is read + comment only per-Project.

## 4. Modules & Endpoints

### 4.1 Auth/Users
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/refresh`
- `GET /api/v1/auth/me`
- `CRUD /api/v1/users` (admin only)

Model: `users(id, username unique, password_hash bcrypt12, name, role[admin|manager|member|guest], active)`

### 4.2 Projects
- `CRUD /api/v1/projects`
- `CRUD /api/v1/projects/{id}/members`

Models:
- `projects(id, name, code unique [A-Z0-9-]{2-12}, description, owner_id -> users, status_profile_id -> status_profiles, start_date, target_date, created_at)`
- `project_members(project_id, user_id, role)`
- Rule: deleting project soft-deletes tasks.

### 4.3 Status Profiles + Project Templates
- `CRUD /api/v1/status-profiles`
- `POST /api/v1/status-profiles/{id}/clone` (save as template)
- `POST /api/v1/projects/{id}/apply-profile/{profile_id}` (copies Statuses + Field Defs into Project)
- `CRUD /api/v1/status-profiles/{id}/statuses`

Models:
- `status_profiles(id, name, is_template, created_by -> users)`
- `statuses(id, profile_id -> status_profiles, name, color, order, is_done, is_blocked)`
- `custom_field_defs(id, profile_id nullable -> status_profiles, project_id nullable -> projects, key, type[text|number|url|date|dropdown|checkbox|user], label, required bool, order)` — defined once in Template, copied to Project on apply.
- `custom_field_values(task_id -> tasks, def_id -> custom_field_defs, value)`

Seed templates:
- `Procurement: Get prior approval > Prepare quotes > Evaluation > Closed`
- `Monthly repetitive: Due > Paid > Verified > Closed`

Rule: Tasks always FK to `status_id` within the project's profile — allows per-Project custom flow. One-off Projects and repetitive-process Projects use different Templates.

### 4.4 Tasks (Task > Subtask 1.1 > Microtask 1.1.1)
- `CRUD /api/v1/tasks`
- `POST /api/v1/tasks/{id}/status` (change Status + set Status Period dates)
- `POST /api/v1/tasks/{id}/comments`
- `GET /api/v1/tasks/{id}/history`
- `GET /api/v1/tasks/blocked-map?project_id=`
- `GET /api/v1/tasks/timeline?project_id=` (execution timeline from Status Periods)

Hierarchy:
- `tasks(id, project_id -> projects, parent_id nullable -> tasks, depth[0|1|2], title, description_md, status_id -> statuses, priority[urgent|high|normal|low], start_date (whole process start, separate column, required), due_date nullable, estimate_mins nullable, time_spent_mins default 0, created_by -> users, updated_at)`
- `depth 0 = Task (e.g. Task 1), 1 = Subtask (e.g. 1.1), 2 = Microtask (e.g. 1.1.1, leaf)`. Max two levels inside a Task. Same-Project parent only. API rejects depth 3+.
- Minimum required on create: `title, start_date, status_id`. Everything else optional / custom.
- `task_assignees(task_id, user_id)` M2M
- `task_watchers(task_id, user_id)` M2M
- `tags(id, name unique)` + `task_tags(task_id, tag_id)` M2M
- `task_blocked_by(task_id, blocked_by_task_id)` self-M2M, no self/circular refs (API validates)
- `task_comments(id, task_id, parent_id nullable -> task_comments, author_id -> users, body_md, mentions[user_ids], created_at)` threaded, markdown
- `task_history(id, task_id, from_status nullable -> statuses, to_status -> statuses, actor -> users, at)` for every mutation
- `task_attachments(id, task_id, filename, path, size, uploaded_by, created_at)` — MVP in v0.2, 10MB limit

Status Period (per-Status dates, all optional):
- `task_status_periods(id, task_id -> tasks, status_id -> statuses, start_date nullable, due_date nullable (planned end), actual_end_date nullable (actual), actor -> users, created_at, updated_at)`
- One row per `(task_id, status_id)` — upsert on `POST /tasks/{id}/status`. Past periods retained for timeline.
- `start_date` defaults to Status entry date if left blank, overridable (e.g. request letter sent 01-01-2026 vs entry date).
- TaskDrawer shows current Status with its `start / due / actual` dates next to the Status selector. Whole-process `tasks.start_date` shown as separate column in List/Table/Timeline.
- Example: Task `Purchase a laptop` in Project `Procurements`: `Get prior approval start 01-01-2026 actual 10-01-2026`, `Prepare quotes start 12-01-2026 due 22-01-2026`, `Evaluation actual 25-01-2026`.

### 4.5 Dashboard / Views / Timeline (read-only, no own tables except cache)
- `GET /api/v1/dashboard/summary?project_id=` -> `{by_status:{}, overdue:int, due_soon:int, blocked:int, total:int, workload:[{user, open, overdue}]}`
- `GET /api/v1/tasks?project_id=&status=&assignee=&watcher=&tag=&blocked=true&overdue=true&search=&depth=` for List/Board/Calendar/Table
- `GET /api/v1/tasks/blocked-map?project_id=` -> `[{task, blocked_by:[...]}]`
- `GET /api/v1/tasks/timeline?project_id=` -> `[{task_id, title, depth, parent_id, status, periods:[{status, start_date, due_date, actual_end_date}]}]` for execution timeline
- Views in v0.2: List (filter/search/group by Status/assignee), Board (Kanban drag-drop changes Status + upserts Period), Calendar (by Status Period due + Task due), Table (columns: Task, Status + dates, start, assignees, custom fields), Dashboard (counts, overdue, blocked), Workload (per-user open/overdue), Timeline (per-Status bars from Periods).
- Notifications: in-process event `task.status_changed`, `task.comment_added` in `events.py`; in-app feed stub. Email/SMS deferred.

### 4.6 Deferred (P3 stubs, additive only)
- `POST /api/v1/notify/*` (email/SMS), `GET /api/v1/gantt`, `GET /api/v1/mindmap`, Drive-sync job, recurring tasks, automation rules

## 5. UI (v0.2) — bound to `sampleui.html` (5 pages, canonical)
Source: `sampleui.html` at repo root. Each sample page maps 1:1 to a route. Visual system: dark theme, Tailwind, Material Symbols. All pages share breadcrumb strip `Project code > Title` + summary badges + role-gated tab bar `Board | List | Calendar | Table | Execution Timeline | Dashboard | Workload | Settings`.

### P1 Projects Directory (sample page 2)
Route `/projects`. Cards/table of Projects membership-filtered. Shows code, name, span dates, task counts, owner. Search + create (manager/admin). API: `GET /projects`, `POST /projects`. Acceptance: guest sees only member Projects; non-member fetch returns 404.

### P2 Board — Kanban + Task Hierarchy (sample page 3)
Route `/projects/{id}/board`. Columns = Statuses of the Project Profile (e.g. Get Prior Approval > Prepare Quotes > Evaluation > Closed). Cards show code, priority, dates, subtask/microtask preview accordion (1 > 1.1 > 1.1.1), tags, assignees, estimate vs spent, blocked pill with dependency link. Drag-drop changes Status and upserts Status Period. Filters: search, group-by, depth filter, blocked-only toggle. API: `GET /tasks?project_id=&depth=&blocked=&search=`, `POST /tasks/{id}/status`, `GET /tasks/blocked-map`. Acceptance: drop to new column writes `task_history` + upserts `task_status_periods`; blocked task shows red bar and connector.

### P3 Execution Timeline + WBS Inspector (sample page 1, default landing)
Route `/projects/{id}/timeline`. Layout: breadcrumb + stage pipeline (4 stages with elapsed/planned, % done) + KPI strip (planned vs actual, variance, blocked path) + split workspace left WBS table (WBS, Task name indented by depth, Status Period chip, stakeholder initials, Due) + right Gantt (Week/Month granularity, depth filter, toggles for stakeholder overlay / Status Periods / critical path, Today line, SVG dependency connectors, stacked per-Status bars with progress fill) + bottom inspector (selected Task header, Update Status Period + Edit stakeholders + Audit Trail actions, stakeholder breakdown, Status Periods log with start → due / actual + actor). Controls: Project/Root Task selector, Day/Week/Month/Quarter toggle, Depth 0/1/2 filter, Jump Today, Export PDF/JSON. API: `GET /tasks/timeline?project_id=`, `GET /tasks/{id}/history`. Acceptance: stacked bars match `task_status_periods`; depth filter hides/shows 1.1 / 1.1.1 rows and bars; timeline derived only from periods + `tasks.start_date`.

### P4 Dashboard + Workload (sample page 4)
Route `/projects/{id}/dashboard`. KPI cards from `GET /dashboard/summary` (total, overdue, due soon, blocked, telemetry), status pipeline flow with counts, mini target-vs-actual bars, dependency preview (root blocker → impacted), team capacity rows with meters, audit/event stream (`task.status_changed`, `task.comment_added`), storage/backup card. Refresh + Export actions. Acceptance: numbers equal API summary; workload rows respect view-access matrix (member no Workload).

### P5 Task Drawer — slide-over (sample page 5, overlays P2/P3)
Route overlay `/projects/{id}/tasks/{taskId}`. Sections: top bar (breadcrumb, priority picker, watchers count, close), title + whole-process start banner (separate prominent field per §4.4), Status Period execution box (Status select + start / planned due / actual end inputs + micro-bar + period history table), metadata grid (assignees, watchers, blocked/depends-on + Template custom fields), hierarchy tree (0 root + 1.1 + 1.2 + 1.2.1/1.2.2 microtasks + sign-off), tabs Comments (threaded + mentions + markdown composer) / Attachments (10MB, uploads volume indicator) / Audit, footer Save + status change. API: `CRUD /tasks`, `POST /tasks/{id}/status`, `POST /tasks/{id}/comments`, `GET /tasks/{id}/history`. Acceptance: current Status dates shown beside selector; saving writes period + history event; Microtask leaf cannot gain children.

Global rules: view-access matrix in §3 enforced per route + per API; `modules/registry.ts` lazy routes `{id, route, navLabel, requiredRole}` matching P1-P5.

## 6. NFR
- Perf: <200ms API p95 on LAN, 20 concurrent users
- Security: bcrypt12, JWT secret via env, RBAC dependency per-request + view-level checks + membership checks
- Data: SQLite WAL, nightly `sqlite3 .backup` + tar of `/data` (db + uploads)
- Deploy: `docker compose up -d` on Ubuntu 22.04/24.04 + Caddy, no internet required
- Files: 10MB limit, local disk, AV scan deferred (LAN-only OK)

## 7. Modularity Contract (no-touch rule)
1. 1 module = 1 folder + 1 router prefix + owns its tables.
2. No cross-imports of models, only via `service.py` + events (`task.status_changed` in `events.py` pub/sub in-process for MVP).
3. Additive only: new tables/columns nullable + Alembic migration, never rename existing fields.
4. Frontend: new views via `modules/registry.ts` lazy route (`{id, route, navLabel, requiredRole}`).
5. Dashboard calls service functions, never direct SQL joins into future tables.

Example: Adding Gantt later = new `gantt` backend router that reads via `tasks.service.list()` + `timeline()` + new frontend route. Zero changes to `tasks`, `projects`, `dashboard`.

## 8. Ticket slices (vertical, UI-bound — ready for breakdown)
Each slice is demoable end-to-end (schema + API + UI + test) and names its sample page. Blocking edges are hard gates.
- T1 Auth + membership + view-gate seam (blocks all): login/JWT, `project_members`, role → views matrix, `registry.ts requiredRole`. Sample: tab bar gating.
- T2 Projects Directory P1 (blocked by T1): CRUD projects + members, list/search. Sample page 2.
- T3 Templates + Status Profiles (blocked by T1): profiles/statuses CRUD, clone, apply-profile copies Statuses + Field Defs. No UI beyond Settings + Templates manager.
- T4 Board P2 + hierarchy + periods write (blocked by T2, T3): depth 0/1/2 CRUD, drag-drop → `POST /status` + period upsert + history, blocked-map. Sample page 3.
- T5 Timeline P3 + inspector read (blocked by T4): `GET /timeline`, WBS + Gantt + pipeline + inspector log. Sample page 1 (default landing).
- T6 Task Drawer P5 (blocked by T4): full drawer sections 1-7 incl. periods box, custom fields, tree, comments/attachments/audit. Sample page 5.
- T7 Dashboard + Workload P4 (blocked by T5): summary, capacity, audit stream. Sample page 4.
- T8 List + Calendar + Table + Settings parity (blocked by T4): same `GET /tasks` filters, calendar by due, table columns incl. custom fields, members/template apply. Uses P2/P3 components.
- T9 Export + polish (blocked by T5, T7): Jump Today, granularity/depth filters, PDF/JSON export, telemetry/backup card.
