# Tree-only List, no flat view

List renders only the hierarchical Task / Subtask / Microtask tree (depth pills Tasks-only / Tasks+Subtasks / All); the flat grouped list, grouping switcher, and List-level TaskFilters were removed. `GET /tasks/timeline` now also carries `priority` and assignee display names so the tree grid can render Assignee + Priority columns without a second users fetch.
