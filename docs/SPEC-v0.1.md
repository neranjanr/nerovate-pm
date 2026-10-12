# NRG Projects — SPEC-v0.1

## 1. Goal
On-prem ClickUp-lite for 20 users, Ubuntu + Docker Compose. Modules: Auth, Projects, Status Templates, Tasks/Subtasks, Kanban/List/Dashboard. Future: Gantt, Mindmap, Docs, Email/SMS, Drive-sync without touching working modules.

## 2. Stack
Frontend: React + Vite + TS + Tailwind. Backend: FastAPI + SQLModel. DB: SQLite WAL at `/data/nrg.db`. Files: `/data/uploads`. Proxy: Caddy. All APIs under `/api/v1`.

Monorepo layout:
```
/frontend/src/{pages,components,stores,modules/registry.ts}
/backend/app/{auth,users,projects,tasks,statuses,dashboard,files,events.py}
/data/ (sqlite + uploads, docker volume, NOT in git)
docker-compose.yml + Caddyfile
```

## 3. Roles
`admin > manager > member`. MVP auth: username/password + JWT (access 60m + refresh 7d). Admin creates users. Later: TOTP, SSO as new `auth_mfa` module.

## 4. Modules & Endpoints

### 4.1 Auth/Users
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/refresh`
- `GET /api/v1/auth/me`
- `CRUD /api/v1/users` (admin only)

Model: `users(id, username unique, password_hash bcrypt12, name, role[admin|manager|member], active)`

### 4.2 Projects
- `CRUD /api/v1/projects`
- `CRUD /api/v1/projects/{id}/members`

Models:
- `projects(id, name, code unique [A-Z0-9-]{2-12}, description, owner_id -> users, status_profile_id -> status_profiles, start_date, target_date, created_at)`
- `project_members(project_id, user_id, role)`
- Rule: deleting project soft-deletes tasks.

### 4.3 Status Profiles (Templates)
- `CRUD /api/v1/status-profiles`
- `POST /api/v1/status-profiles/{id}/clone` (save as template)
- `POST /api/v1/projects/{id}/apply-profile/{profile_id}`
- `CRUD /api/v1/status-profiles/{id}/statuses`

Models:
- `status_profiles(id, name, is_template, created_by -> users)`
- `statuses(id, profile_id -> status_profiles, name, color, order, is_done, is_blocked)`

Seed templates:
- `Software: Todo > Doing > Blocked > Done`
- `Approval: Initiated > Submitted > Approval Received > Closed`

Rule: Tasks always FK to `status_id` within the project's profile — allows per-project custom flow.

### 4.4 Tasks
- `CRUD /api/v1/tasks`
- `POST /api/v1/tasks/{id}/comments`
- `GET /api/v1/tasks/{id}/history`
- `GET /api/v1/tasks/blocked-map?project_id=`

Model:
- `tasks(id, project_id -> projects, parent_id nullable -> tasks (1-level, same project), title, description_md, status_id -> statuses, priority[L/M/H], date_initiated, date_approval_received, due_date, time_target_hours, created_by -> users, updated_at)`
- `task_assignees(task_id, user_id)` M2M
- `task_blocked_by(task_id, blocked_by_task_id)` self-M2M, no self/circular refs (API validates)
- `task_comments(id, task_id, author_id -> users, body, created_at)` = status updates feed
- `task_history(id, task_id, from_status -> statuses, to_status -> statuses, actor -> users, at)`

### 4.5 Dashboard (read-only, no own tables)
- `GET /api/v1/dashboard/summary?project_id=` -> `{by_status:{}, overdue:int, due_soon:int, blocked:int, total:int, workload:[{user, open, overdue}]}`
- `GET /api/v1/tasks?project_id=&status=&assignee=&blocked=true&overdue=true&search=` for List/Kanban
- `GET /api/v1/tasks/blocked-map` -> `[{task, blocked_by:[...]}]` to show "what is blocked and what is blocking"

### 4.6 Deferred (P2/P3 stubs, additive only)
- `task_attachments(id, task_id, filename, path, size, uploaded_by)` — full UI in P2
- `custom_field_defs(id, project_id, key, type[text|url|date], label)` + `custom_field_values(task_id, def_id, value)` — for links, award date, expiry date
- `POST /api/v1/notify/*` (email/SMS), `GET /api/v1/gantt`, `GET /api/v1/mindmap`, Drive-sync job

## 5. UI (MVP)
1. Login
2. Projects list
3. ProjectDetail tabs: Board (Kanban drag-drop changes status) | List (filter/search) | Dashboard (counts, overdue, blocked list) | Settings (apply template, members)
4. TaskDrawer: details + dates + assignees + blocking picker + comments timeline
5. Admin: Users
6. Templates: Status Profile manager

## 6. NFR
- Perf: <200ms API p95 on LAN, 20 concurrent users
- Security: bcrypt12, JWT secret via env, RBAC dependency per-request
- Data: SQLite WAL, nightly `sqlite3 .backup` + tar of `/data` (db + uploads)
- Deploy: `docker compose up -d` on Ubuntu 22.04/24.04 + Caddy, no internet required
- Files P2: 10MB limit, local disk, AV scan deferred (LAN-only OK)

## 7. Modularity Contract (no-touch rule)
1. 1 module = 1 folder + 1 router prefix + owns its tables.
2. No cross-imports of models, only via `service.py` + events (`task.status_changed` in `events.py` pub/sub in-process for MVP).
3. Additive only: new tables/columns nullable + Alembic migration, never rename existing fields.
4. Frontend: new views via `modules/registry.ts` lazy route (`{id, route, navLabel}`).
5. Dashboard calls service functions, never direct SQL joins into future tables.

Example: Adding Gantt later = new `gantt` backend router that reads via `tasks.service.list()` + new frontend route. Zero changes to `tasks`, `projects`, `dashboard`.
