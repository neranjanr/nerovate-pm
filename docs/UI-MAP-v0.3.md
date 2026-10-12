# UI Map v0.3 — delta on UI-MAP-v0.2

v0.2 pages P1–P5 unchanged except breadcrumb + filters. One new page P0.

## P0 — Categories Directory → `GET /categories` (new, Ticket U1)
Route `/categories`. Cards/table: color dot, `key` (immutable, e.g. CAT-PROC), name (mutable), project count, profile name. Search + `[+Add Category]` (name+color only). Click → `/categories/{id}` Project list `[+Add Project]`. Binds `CRUD /categories`, `CRUD /categories/{id}/members`, `GET /categories/{id}/projects`. Acceptance: rename keeps key; non-member 404.

## P1 — Projects Directory → now `GET /projects?category_id=` (Ticket U2)
Same cards as v0.2 + Category switcher + `Linked projects` chip preview. Breadcrumb `Category > Project code`. Acceptance: same code allowed in two Categories; same name twice in one Category rejected.

## P2 — Board → tiered Stages (Ticket U5)
Stage header row (collapse/expand, counts, % done) over leaf Status columns; expanded Stage scrolls horizontally (15–20 columns). Column header = shade chip of Stage base. Drag-drop across Statuses/Stages writes period + history. Binds `GET /tasks?project_id=&stage_id=`, `POST /tasks/{id}/status`.

## P3 — Timeline → pipeline = Stages (Ticket U5)
Pipeline blocks = Stages from Category Profile; expand → leaf Status segments from `task_status_periods`. Binds `GET /tasks/timeline?project_id=&stage_id=`.

## P5 — Drawer → grouped Status select (Tickets U3/U4)
Status dropdown grouped by Stage optgroups; create-Task modal title-only (status/start defaulted, shown as hints).

## Shared chrome
Breadcrumb `Category name > Project code > Title` + tab bar from v0.2 matrix checked against effective membership (category ∪ project). Modules registry: add `{id:'categories', route:'/categories', navLabel:'Categories', requiredRole:'member'}`.
