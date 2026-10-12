# V1 — Sibling position + Project tree default (blocks all Phase-4)

Schema: `tasks.position` integer rank per parent scope (per-Project for Tasks, per-Task for Subtasks, per-Subtask for Microtasks); `projects.tree_default [tasks-only|tasks-subtasks|all]` default `all`. API: reorder within same parent only `{item_id, to_position}` else 400, returns renumbered siblings; `GET/PATCH /projects/{id}/tree-default` Owner-only write. Migration additive: nullable, backfill from creation order, then constrain. Reorder writes `task_history (reordered old-WBS -> new-WBS by X)`, no `task_status_periods` change, no Assignee/Watcher notify.
Acceptance: same-parent reorder persists + WBS renumbers; cross-parent rejected; member reorder ok, guest 403; Owner default set ok, member 403; backfill preserves id order.
Blocked-by: none (first). Blocks: V2, V3, V4.
