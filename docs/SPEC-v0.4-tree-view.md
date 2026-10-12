# Nerovate-PM — Indent Tree + Reorder Spec (Phase 4)

## Problem Statement

In Project view I add a Subtask under a Task, then Microtasks under that Subtask, but the list looks flat. I cannot tell at a glance what is a Task vs Subtask vs Microtask, I cannot collapse a Task to focus, and I cannot reorder siblings by drag. With 20 users sharing one on-prem system, order churn without confirmation is risky.

## Solution

Show hierarchy as an indent tree with WBS numbers (`1 / 1.1 / 1.1.1`) in Timeline WBS pane first, then the same tree in List. Support per-Task and per-Subtask expand/collapse, toolbar Collapse all / Expand all, and a per-Project default (`Tasks only / Tasks+Subtasks / All`). Allow drag-reorder within the same parent only, with an explicit Confirm modal on every drop. Sibling order persists and WBS numbers recompute immediately.

## User Stories

1. As an Owner, I want to set a per-Project default tree view (`Tasks only / Tasks+Subtasks / All`), so that the team opens the Project at the right level of detail.
2. As a team member, I want Tasks at indent 0, Subtasks indented once, Microtasks indented twice, so that parent-child is obvious when scanning.
3. As a team member, I want every row to show its WBS number (`1 / 1.1 / 1.1.1`) in sibling order, so that I can reference items verbally.
4. As a team member, I want a chevron on each Task with children to expand/collapse it, so that I can focus on one delivery.
5. As a team member, I want a chevron on each Subtask with Microtasks to expand/collapse it independently, so that deep trees stay navigable.
6. As a team member, I want toolbar buttons Collapse all and Expand all, so that I can reset a large Project in one click.
7. As a team member, I want my manual expand/collapse to override the default temporarily for my session, so that exploration does not change the team default.
8. As a guest, I want to expand/collapse locally without changing any stored default, so that I can read without side effects.
9. As a team member, I want a collapsed Task to show `+N Subtasks, M Complete`, so that hidden work is not invisible.
10. As a team member, I want a collapsed Subtask to show `+N Microtasks, M Complete`, so that leaf progress is visible.
11. As a team member, I want List tree mode to force flat grouping off, so that hierarchy order is not contradicted by status/assignee groups.
12. As a team member, I want drag to work for Tasks among Tasks in the same Project, so that top-level priority order is adjustable.
13. As a team member, I want drag to work for Subtasks among siblings under the same Task, so that step order is adjustable.
14. As a team member, I want drag to work for Microtasks among siblings under the same Subtask, so that leaf order is adjustable.
15. As a team member, I want every drop to show a Confirm modal with `WBS Title: position A → B`, so that accidental drops do not silently reorder.
16. As a team member, I want Cancel in the confirm modal to leave order untouched, so that exploration is safe.
17. As a team member, I want drag disabled with an explanatory tooltip when any filter/search/depth filter is active, so that a partial view cannot corrupt full order.
18. As a team member, I want WBS numbers to renumber immediately after Confirm for all affected siblings, so that references stay correct.
19. As a team member, I want adding a Subtask under a collapsed Task to auto-expand the parent chain and highlight the new row, so that the new item is not lost.
20. As a team member, I want adding a Microtask under a collapsed Subtask to auto-expand and highlight it, without changing the stored Project default, so that creation is visible but defaults are stable.
21. As a team member, I want collapsing a Task in Timeline to hide its Subtask/Microtask Gantt bars together, leaving a parent summary bar from earliest start to latest due, so that left table and right chart stay in sync.
22. As a team member, I want reorder to write a lightweight history entry `reordered 1.2 → 1.4 by X`, so that order churn is auditable.
23. As a Watcher, I want no notification on pure reorder, so that I am not spammed by sequencing tweaks.
24. As an Assignee, I want assignment, Status, and Status Period untouched by reorder, so that scheduling is independent of sequencing.
25. As an Owner, I want only Owners to change the stored Project default, while Task editors can reorder, so that defaults are stable but work can be sequenced.

## Implementation Decisions

- Seams (confirmed): (1) Backend API seam for persistent sibling order + Project tree default; (2) Frontend single reusable WbsTree component used first in Timeline, then in List. One shared component, not duplicated tree logic per view.
- Scope: tree applies to Timeline WBS left pane first, then List. Board, Table, Calendar, Dashboard stay flat with existing depth filter.
- Numbering: WBS derived from sibling `position` order, not from IDs. Format: Task `N`, Subtask `N.M`, Microtask `N.M.K`. Renumber is a pure function of ordered sibling lists.
- Schema: add persistent sibling `position` (integer rank per parent scope: per-Project for Tasks, per-Task for Subtasks, per-Subtask for Microtasks). Additive migration: nullable first, backfill from creation order, then constrain. Never rename existing fields.
- Ordering rule: order is global per parent, independent of Status, Assignee, or Stage. Filters do not change stored order; drag is blocked while filtered.
- Reorder API contract (conceptual):
  - Move request: `{ item_id, to_position }` validated as within same parent only; cross-parent rejected.
  - Response returns reordered sibling list with fresh WBS numbers.
  - Default view API: `GET/PATCH Project tree default` with values `tasks-only | tasks-subtasks | all`, default `all`, Owner-only write.
- Permissions: reorder allowed for roles that can edit Tasks today (same gate as Status move); change default Owner-only; guests read + local expand only. Effective role uses existing Category-union plus Project membership rule.
- Confirm interaction: drop → modal `WBS 'Title': position A → B` + Confirm/Cancel. Confirm persists, triggers renumber + history write. Cancel is no-op, selection returns to pre-drag.
- Collapsed summary: counts derived from direct children Statuses (`total`, `complete` where Status is terminal in its Profile). No extra fetch beyond existing children payload.
- Gantt sync: collapsed state is a view filter applied to both panes. Parent summary bar spans min child start to max child due when children hidden; actual child periods unchanged.
- New-child behavior: creation auto-expands ancestor chain client-side and flashes new row; does not PATCH the stored default.
- History: reorder appends a TaskHistory row with actor, old/new WBS + positions. No Status Period upsert, no Assignee/Watcher side effects.
- List grouping: entering tree mode sets grouping to none and disables the grouping control with explanation; leaving tree mode restores prior grouping selection ephemerally.

## Testing Decisions

- What makes a good test: assert external behavior only (API responses, rendered tree order, modal outcomes), not implementation details (drag events, CSS classes, internal state names).
- Backend seam tests:
  - Same-parent reorder persists and returns renumbered WBS; cross-parent move rejected.
  - Reorder while filtered is rejected or ignored (server validates full sibling scope, not partial view).
  - Migration backfill preserves creation order for Projects without explicit positions.
  - Project default read/write permissions: Owner can set, member cannot, guest cannot.
  - History row written on reorder; no Status Period created.
- Frontend seam tests:
  - Indent + WBS render for 3-level fixture; chevrons toggle children visibility.
  - Collapse all / Expand all + default selector switch visible row sets correctly.
  - Drop → Confirm modal shows `A → B`; Confirm changes order, Cancel leaves order.
  - Drag disabled with tooltip when search/filter active.
  - New Subtask auto-expands collapsed parent and highlights new WBS.
- Prior art to extend: backend hierarchy/period tests for Tasks and Timeline, frontend depth-filter and export/WBS-number unit tests. Prefer extending those suites over new harnesses.

## Out of Scope

- Cross-parent moves (Subtask to different Task, Microtask to different Subtask) — explicit re-parent flow deferred to later phase.
- Tree in Board, Table, Calendar, Dashboard; cross-Project rollup or cross-Project blocking via order.
- Silent auto-save or undo-toast instead of Confirm modal; bulk multi-select reorder.
- Notifications to Assignees/Watchers on reorder; changes to Status, Status Period, dates, or effort from reorder.
- Per-user persisted expand state (ephemeral only this phase); keyboard DnD and touch reorder polish beyond basic focusable chevrons.
- Export/print custom layouts — existing JSON/CSV export includes WBS + position but no new format.

## Further Notes

- Glossary unchanged: Task, Subtask (`1.1`), Microtask (`1.1.1` leaf) already defined in CONTEXT.md. `position` is implementation detail, not domain language.
- Consider ADR for persistent `position` vs `ORDER BY id` if migration cost grows (hard to reverse, surprising without context). Not written in this spec.
- Tracker: Phase-4 tickets in `docs/tickets/phase4/V1-V4.md`. Local-markdown tracker configured in `docs/agents/issue-tracker.md`.
