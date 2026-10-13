# 01: Task View memory across Projects

**What to build:** As a team member in a Task View (e.g. Kanban) I select another Project and land in the same View for that Project, not its default List view.

**Blocked by:** None (can start immediately).

**Status:** implemented (pending verification)

- [x] Switching Projects preserves the current Task View (List, Board, Timeline, Table, Calendar, Dashboard); Mind Map View stays separate
- [x] URL carries `?view=` as source of truth with per-tab session fallback; unrenderable Views fall back to List
- [x] Per-Project tree depth default still applies inside the preserved View (View choice and tree depth are orthogonal)
- [x] Category switches keep the memorized View for the next Project opened; nothing persists across reloads, users, or DB

## Comments

- Implemented via `frontend/src/utils/taskViewMemory.ts` (pure seam, 12 vitest cases) + wiring in `App.tsx` (`ViewMemorySync`, `ProjectIndexRedirect`), `Sidebar.tsx`, `Projects.tsx`, `CategoryDetail.tsx`. No backend changes (nothing persists to DB by design).
- URL shape decision: `/projects/:id/<view>` stays canonical (existing router); `?view=` is honored as an alias and folded into the path by `ViewMemorySync`, so bookmarks/deep-links with `?view=` work but the URL afterwards carries the path segment as source of truth.
- Session fallback is an in-memory module singleton (per-tab JS realm, cleared on reload) rather than `sessionStorage`, so "nothing persists across reloads" holds literally.
- Kanban/Status memorized too (ticket example names Kanban); `workload` normalizes to `dashboard`. Mind Map View and project settings never overwrite memory.
- Task-highlight jumps stay on List (`highlight` is consumed only by `List.tsx`); role-gated recalls (e.g. guest + dashboard) fall back to List via `canAccessView`.
- Tree-depth orthogonality by non-interference: no tree-default code touched; each view keeps fetching `tree-default` per Project.
- Code review (standards + spec axes) findings addressed: CONTEXT glossary "Mind Map View" spelling; `rememberTaskView` now role-gated at store time. Full suites green: frontend 58/58 incl. new file, backend 95/95, `tsc --noEmit` clean.
