# Nerovate-PM — SPEC-v0.3 (Phase 2)

Delta on top of SPEC-v0.2 (v0.2 untouched). Covers: Categories, Stage-grouped Status Profiles by reference, title-only Tasks, tiered Board/Timeline, cross-Category Project links, Nerovate-PM rebrand.

## 1. Goal
Same on-prem 20-user system (Ubuntu + Docker Compose). Phase 2 adds one hierarchy level on top: `Category > Project > Task (0) > Subtask (1.1) > Microtask (1.1.1)`. Procurement example: `Category Procurements` contains `Projects Purchase laptop, Buy server`; each Project contains Tasks. Follow-on example: close `Procurements / Buy server`, open `OPEX Items / Buy server` for monthly payments, link them continues-as.

## 2. Stack (rebrand)
Same as v0.2 except names: Frontend `nerovate-frontend`, backend `FastAPI(title="Nerovate-PM")`, DB SQLite WAL at `/data/nerovate.db`, volume `nerovate-data`, localStorage keys `nv_access/nv_role/nv_user/nv-theme`. All APIs stay under `/api/v1`. Migration: on first boot copy `/data/nrg.db` → `/data/nerovate.db` if target missing; frontend dual-reads `nrg_*` keys as fallback for one release.

Files to rename (verified hits): `docker-compose.yml (DATABASE_URL, volume)`, `backend/Dockerfile`, `backend/app/db.py:5`, `backend/app/dashboard/service.py:146`, `backend/app/main.py:22`, `frontend/package.json + package-lock.json`, `frontend/index.html`, `frontend/src/stores/auth.tsx`, `frontend/src/stores/theme.tsx`, `frontend/src/pages/Login.tsx`, `start-service.ps1`, `CONTEXT.md`, `docs/SPEC-*.md` headers. Repo folder `C:\labs\NRG Projects` NOT renamed.

## 3. Roles & Access (extends v0.2 §3)
Same view matrix. Membership becomes hybrid:
- `category_members(category_id, user_id, role)` — member sees ALL Projects in Category.
- `project_members(project_id, user_id, role)` (existing) — member sees that Project only.
- Effective visibility = union. Effective role = max(category role, project role) with admin > manager > member > guest. Guest read + comment only.
- Non-member fetch returns 404 (no enumeration), same as v0.2.
- `POST /projects` requires membership (any role ≥ member) in parent Category or global admin/manager; `POST /categories` requires admin/manager.

## 4. Modules & Endpoints

### 4.1 Categories (new module `categories`)
- `CRUD /api/v1/categories`
- `CRUD /api/v1/categories/{id}/members`
- `GET /api/v1/categories/{id}/projects`

Model:
- `categories(id, key stable immutable e.g. CAT-PROC unique, name mutable globally unique, color e.g. #6b7280, status_profile_id -> status_profiles nullable, created_by, created_at)`
- `category_members(category_id, user_id, role)`
- Rules: Category has no dates. Rename changes `name` only, never `key`. Deleting Category soft-deletes its Projects (same cascade rule as Project → Tasks). `+Add Category` lives on `/categories` directory.

### 4.2 Projects (moves one level down)
- Existing `CRUD /api/v1/projects` + members stay; add `?category_id=` filter; `GET /categories/{id}/projects`.
- `POST /api/v1/projects/{id}/links`, `GET .../links`, `DELETE .../links/{link_id}` for cross-Category refs.

Models:
- `projects(id, category_id -> categories NOT NULL index, name UNIQUE within category, code UNIQUE within category [A-Z0-9-]{2-12}, description, owner_id, start_date, target_date, created_at)`. Drops own `status_profile_id` (column kept nullable unused for back-compat; Profile resolved via parent Category).
- `project_links(id, from_project_id -> projects, to_project_id -> projects, kind[relates-to|continues-as] default relates-to, note default "", created_by, created_at)`. Rules: no self-link; same pair+kind unique; allowed across Categories; plain link only — no date rollup, no cross-Project blocked-by, no Timeline merge.
- Migration: existing v0.2 Projects become one Category each? Implementer choice with default: create Category per old Project (`key=CAT-<CODE>`, same name/color default) and set `projects.category_id` accordingly, preserving `code` (now scoped). Must keep additive migration (nullable `category_id` first, backfill, then NOT NULL).

### 4.3 Status Profiles + Stages (extends v0.2 §4.3)
- `CRUD /api/v1/status-profiles` (now created/chosen per Category; `categories.status_profile_id` is the live reference).
- `CRUD /api/v1/status-profiles/{id}/stages` → `status_stages(id, profile_id, name, order, color_base)`.
- `CRUD /api/v1/status-profiles/{id}/statuses` gains `stage_id -> status_stages`; `CRUD /stages/{id}/statuses`.
- `DELETE /statuses/{id}?replacement_id=` remap flow.

Models:
- `status_stages(id, profile_id -> status_profiles index, name, order, color_base default #6b7280)`
- `statuses` adds `stage_id -> status_stages nullable index, shade nullable` (shade = derived tint of Stage base unless overridden). Existing rows migrate into one Stage `Main` preserving `order`.
- Inheritance is BY REFERENCE: `Project → Category → Profile → Stages → Statuses`. Editing Profile/Stages/Statuses is immediately visible to all Projects in Category. No per-Project copy (v0.2 `apply-profile` copy is retired for new data; old copied data stays readable).
- Add rule: new Status appended at end of chosen Stage (`order = max+1`), existing `task_status_periods` untouched; new Tasks can pick it immediately.
- Delete rule: if any `tasks.status_id` or `task_status_periods.status_id` references it → `409 {usage_tasks, usage_periods}` + require `replacement_id` within same Profile (suggest same-Stage first, allow any Stage override in UI). Server remaps `tasks.status_id`, retains old periods for history, writes `task_history` rows (actor = deleter).
- Seed for Procurements Category: Stage `Prior Approval` (Concept approval to be requested, Pending concept approval, Concept approval ok–proc approval to be requested, Pending proc approval, Procurement approval received) > Stage `Procurement Stage` (Spec to be submitted, Spec submitted–approval pending, Spec approved–pending publishing, Published, Tender closed / Under evaluation, Approval received) > Stage `Post Approval` (Award letter issued, PB received, Implementation, Completed). Colors: three base hues, leaf shades auto-tinted.

### 4.4 Tasks (title-only)
- Same routes as v0.2; hierarchy `Task(0) > Subtask(1.1) > Microtask(1.1.1)` unchanged, same-Project parent only, depth 3+ rejected, Microtask leaf.
- Create minimum: `title` only. Server defaults: `project_id` from URL, `status_id` = first Status of first Stage (ordered), `start_date` = creation date (ISO, editable). `POST /tasks` with missing fields must NOT 422.
- `task_blocked_by` stays same-Project only (validated). Cross-Project dependency deferred.
- Navigation chain: `/categories [+Add Category]` > click Category → Project list `[+Add Project]` > click Project → Task list `[+Add Task]` > click Task → Subtasks `[+Add Subtask]` > click Subtask → Microtasks `[+Add Microtask]`.

### 4.5 Dashboard / Views / Timeline (tiered)
- `GET /dashboard/summary`, `GET /tasks?...`, `blocked-map`, `timeline` all gain `category_id` and/or `stage_id` filters; existing `project_id` filters keep working.
- Board: Stage header row (name, count, % done, collapse toggle). Collapsed = counts only. Expanded = leaf Status columns under that Stage, horizontal scroll for 15–20 columns. Column header shows shade chip. Drag-drop across Statuses (incl. across Stages) writes `task_history` + upserts `task_status_periods` (same as v0.2).
- Timeline: pipeline = Stages (elapsed/planned, % done from leaf periods inside); expand Stage → stacked per-Status bars (same `task_status_periods` source). Depth filter 0/1/2 unchanged.
- Project header shows `Linked projects` chips from `project_links` with cross-Category jump (`OPEX Items / Buy server continues-as`).

### 4.6 Deferred
Unchanged from v0.2 §4.6 (notify, Gantt, mindmap, Drive-sync, recurring, automation) plus: cross-Project blocked-by, cross-Project Timeline rollup.

## 5. UI (v0.3 delta, bound to same `sampleui.html` + one new page)
- P0 Categories Directory (new): route `/categories`. Cards/table: color dot, key, name, project count, profile name. Search + `[+Add Category]` (manager/admin). API `GET/POST /categories`. Acceptance: rename preserves key + links; guest sees only member Categories.
- P1–P5 (v0.2) shift down one level: breadcrumb becomes `Category name > Project code > Title`; P1 Projects Directory gains `?category_id` + Category switcher; P2 Board gains Stage tier headers + horizontal scroll + shade chips; P3 Timeline pipeline = Stages; P5 Drawer Status selector groups options by Stage.
- Global rules: same view-access matrix, now checked against effective (category ∪ project) membership.

## 6. NFR — same as v0.2 §6.

## 7. Modularity Contract — same 5 rules as v0.2 §7 + additive migration rule: new columns nullable first, backfill, then constrain; never rename existing fields (`projects.status_profile_id` retained unused).

## 8. Ticket slices (Phase 2, vertical, ready for to-tickets)
- U1 Categories + hybrid membership (blocks all Phase-2): schema + API + P0 + 404 tests.
- U2 Projects under Category + scoped code + migration (blocked by U1): `category_id`, scoped uniques, backfill, links table.
- U3 Stage-grouped Profiles + remap (blocked by U1): stages CRUD, `stage_id`, add/delete rules, seed Procurements 5+6+4.
- U4 Title-only Tasks (blocked by U2, U3): defaults, no-422, Task>Sub>Micro chain preserved.
- U5 Tiered Board + Timeline (blocked by U3, U4): Stage headers, scroll, shade chips, pipeline aggregation.
- U6 Project links (blocked by U2): CRUD + header chips + jump, no rollup.
- U7 Nerovate-PM rebrand + migration (blocked by U1): renames §2 + db copy + dual-read keys + Login/title checks.
