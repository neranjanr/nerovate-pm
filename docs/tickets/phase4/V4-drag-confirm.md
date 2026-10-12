# V4 — Same-parent drag reorder + Confirm modal

Drag Tasks among Tasks, Subtasks among same-Task siblings, Microtasks among same-Subtask siblings only. Every drop opens Confirm modal `WBS 'Title': position A -> B` + Confirm/Cancel; Cancel no-op; Confirm persists via V1 API, immediate renumber, history row, no Period/notify change. Drag disabled with tooltip when any filter/search/depth active. Permissions: Task editors reorder, Owners change default, guests local expand only.
Acceptance: same-parent drop confirms + renumbers; cross-parent blocked; filtered view drag disabled; Cancel leaves order; history written, no Period created.
Blocked-by: V1, V2, V3. Blocks: none.
