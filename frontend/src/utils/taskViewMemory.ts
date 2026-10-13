import { canAccessView, type Role } from "../modules/registry";

/**
 * Task View memory (01-task-view-memory): switching Projects preserves the
 * current Task View instead of resetting to List.
 *
 * - URL is source of truth: the `/projects/:id/<view>` path segment carries
 *   the view; `?view=` is honored as an alias (bookmarks, palette jumps).
 * - Fallback is per-tab in-memory session state: a module singleton, so each
 *   tab has its own memory and nothing survives a reload, a user change, or
 *   the database (all in-memory, cleared on navigation away is never needed).
 * - Mind Map View stays separate: it is never memorized and never recalled.
 * - View choice is orthogonal to the per-Project tree depth default, which
 *   each view keeps fetching per Project (`tree-default` API untouched).
 * - Unrenderable views (unknown names, role-gated views like dashboard for
 *   guests) fall back to List.
 */

/** Task Views preserved across Project switches (CONTEXT Task View + Kanban). */
export type MemorableTaskView =
  | "list"
  | "board"
  | "kanban"
  | "status"
  | "timeline"
  | "table"
  | "calendar"
  | "dashboard";

export const MEMORABLE_TASK_VIEWS: readonly MemorableTaskView[] = [
  "list",
  "board",
  "kanban",
  "status",
  "timeline",
  "table",
  "calendar",
  "dashboard",
];

export const TASK_VIEW_FALLBACK: MemorableTaskView = "list";

export function isMemorableTaskView(
  value: string | null | undefined
): value is MemorableTaskView {
  return (
    typeof value === "string" &&
    (MEMORABLE_TASK_VIEWS as readonly string[]).includes(value)
  );
}

/** Map route aliases onto memorable views (`workload` renders Dashboard). */
export function normalizeTaskView(
  value: string | null | undefined
): MemorableTaskView | null {
  if (value === "workload") return "dashboard";
  return isMemorableTaskView(value) ? value : null;
}

/** View segment of `/projects/:id/<view>`; null on index/category/other paths. */
export function taskViewFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/projects\/\d+\/([^/?#]+)\/?$/);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

/** Raw `?view=` value; validation happens in normalize/resolve. */
export function taskViewFromSearch(search: string): string | null {
  const query = search.startsWith("?") ? search.slice(1) : search;
  if (!query) return null;
  const value = new URLSearchParams(query).get("view");
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

// Per-tab session fallback: module state lives in this tab's JS realm only,
// so a reload, another tab, another user, or the DB can never observe it.
let memorizedView: MemorableTaskView | null = null;

/**
 * Record the current view; non-memorable views (Mind Map View, settings) keep
 * prior memory. Role-gated views are never stored for a role that cannot
 * render them (unrenderable views fall back to List instead).
 */
export function rememberTaskView(view: string | null | undefined, role?: Role | null): void {
  const normalized = view ? normalizeTaskView(view) : null;
  if (normalized && (!role || canAccessView(role, normalized))) memorizedView = normalized;
}

export function recallTaskView(): MemorableTaskView | null {
  return memorizedView;
}

export function clearTaskViewMemory(): void {
  memorizedView = null;
}

function gateByRole(
  view: MemorableTaskView,
  role: Role | null | undefined
): MemorableTaskView {
  if (role && !canAccessView(role, view)) return TASK_VIEW_FALLBACK;
  return view;
}

/**
 * Resolve the view to render/open: explicit `?view=` wins, then the path
 * segment, then tab-session memory, then List. Unknown or role-gated views
 * fall back to List.
 */
export function resolveTaskView(options: {
  queryView?: string | null;
  pathSegment?: string | null;
  role?: Role | null;
}): MemorableTaskView {
  const candidates: Array<string | null | undefined> = [
    options.queryView,
    options.pathSegment,
    recallTaskView(),
  ];
  for (const candidate of candidates) {
    const normalized = candidate ? normalizeTaskView(candidate) : null;
    if (normalized) return gateByRole(normalized, options.role);
  }
  return TASK_VIEW_FALLBACK;
}

/**
 * View to carry across a Project switch: the view in the current URL when it
 * is a memorable Task View (always fresh at render time), else the tab-session
 * memory, else List. Gated by role; Mind Map never carries over.
 */
export function switchViewFor(
  pathname?: string | null,
  role?: Role | null
): MemorableTaskView {
  const current = pathname ? normalizeTaskView(taskViewFromPath(pathname)) : null;
  if (current) return gateByRole(current, role);
  const remembered = recallTaskView();
  if (remembered) return gateByRole(remembered, role);
  return TASK_VIEW_FALLBACK;
}

/**
 * Target for opening a Project (sidebar, directory, category): the current or
 * memorized Task View when the role can render it, else List. Task-highlight
 * jumps stay on List because highlight is a List-only feature.
 */
export function projectSwitchPath(
  projectId: number | string,
  role?: Role | null,
  options?: { highlightTaskId?: number | null; fromPathname?: string | null }
): string {
  if (options?.highlightTaskId != null) {
    return `/projects/${projectId}/list?highlight=${options.highlightTaskId}`;
  }
  return `/projects/${projectId}/${switchViewFor(options?.fromPathname, role)}`;
}
