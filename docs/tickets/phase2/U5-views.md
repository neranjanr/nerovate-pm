# U5 — Tiered Board + Timeline

Board: Stage header row (collapse/expand, counts, % done) + expanded leaf columns with horizontal scroll + shade chips; drag-drop across Statuses/Stages writes history + period. Timeline: pipeline = Stages, expandable to leaf bars from `task_status_periods`. Filters `stage_id`, depth 0/1/2. Binds `GET /tasks`, `POST /tasks/{id}/status`, `GET /tasks/timeline`.
Acceptance: 15–20 columns scroll under Stages; collapsed shows counts; stacked bars match periods.
Blocked-by: U3, U4. Blocks: none.
