# Spec: Task View memory across Projects

**Status:** ready-for-agent

## Problem Statement

When a user is in a Task View (e.g. Kanban) and selects another Project, the new Project loads its default List view instead of the View the user was in.

## Solution

Persist the last-used Task View per browser tab. Switching Projects keeps the current View (List, Board, Timeline, Table, Calendar, Dashboard). The URL carries `?view=` as source of truth with tab-session fallback; List is the fallback when the persisted View cannot render. View choice is orthogonal to the per-Project tree depth default (`Tasks only / Tasks+Subtasks / All`). Mind Map View stays separate (Category-rooted).

## Out of Scope

- No cross-user or DB persistence of View choice.
- No changes to tree depth defaults or grouping behavior.
