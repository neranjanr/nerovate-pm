# U4 — Title-only Tasks + defaults

Change `POST /tasks` (+ subtask/microtask): require `title` only; default `status_id`=first leaf of first Stage, `start_date`=creation date. Keep depth 0/1/2, same-Project parent, leaf rule, same-Project blocked-by. UI: `[+Add Task/Subtask/Microtask]` title-only modal showing defaulted hints.
Acceptance: title-only create 201 (no 422); defaults correct; depth 3 rejected.
Blocked-by: U2, U3. Blocks: U5.
