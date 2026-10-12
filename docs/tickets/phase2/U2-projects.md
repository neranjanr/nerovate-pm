# U2 — Projects under Category + scoped code + migration

Schema: `projects.category_id NOT NULL` (additive: nullable → backfill one Category per old Project `CAT-<CODE>` → NOT NULL), `UNIQUE(category_id, code)`, `UNIQUE(category_id, name)`; keep `status_profile_id` unused. API: `GET /projects?category_id=`, `POST /projects {category_id,...}`, `GET /categories/{id}/projects`. UI: Category → Project list `[+Add Project]`, breadcrumb `Category > Code`.
Acceptance: same code/name in two Categories OK, twice in one Category 422; old data reachable after backfill.
Blocked-by: U1. Blocks: U4, U6.
