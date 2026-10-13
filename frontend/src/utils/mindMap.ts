/**
 * Mind Map View — pure layout + color-shade seam.
 * No React, no fetch. Tested in mindMap.test.ts.
 *
 * Levels:
 *   Category root: L0 Category → L1 Project → L2 Task → L3 Subtask → L4 Microtask
 *   Project root:  L0 Project → L1 Task → L2 Subtask → L3 Microtask
 */

export type MindMapNodeType = "category" | "project" | "task" | "subtask" | "microtask";
export type MindMapDepth = "overview" | "tasks" | "subtasks" | "full";
export type MindMapLayout = "horizontal" | "vertical";

export interface MindProjectInput {
  id: number;
  code: string;
  name: string;
  color?: string | null;
}

export interface MindTaskInput {
  id: number;
  project_id: number;
  parent_id?: number | null;
  depth: number; // 0 Task, 1 Subtask, 2 Microtask
  title: string;
  // ADR-0010: null when directly assigned onto an empty Stage (see stage_id).
  status_id: number | null;
  stage_id?: number | null;
  assignee_ids?: number[];
  due_date?: string | null;
  is_blocked?: boolean;
}

export interface MindNode {
  key: string;
  type: MindMapNodeType;
  id: number | string;
  projectId?: number | null;
  parentKey: string | null;
  name: string;
  code?: string;
  color: string;
  statusId?: number | null;
  /** ADR-0010: direct empty-Stage assignment (statusId null). */
  stageId?: number | null;
  /** 0 = root … 4 = deepest (category root) / 3 (project root) */
  level: number;
  childCount: number;
  hasChildren: boolean;
}

/** Clamp + normalize #rgb → #rrggbb, fallback to slate on garbage. */
export function normalizeHex(hex: string | null | undefined): string {
  if (!hex) return "#64748b";
  let h = hex.trim().toLowerCase();
  if (!h.startsWith("#")) h = `#${h}`;
  const body = h.slice(1);
  if (/^[0-9a-f]{3}$/.test(body)) {
    return `#${body.split("").map((c) => c + c).join("")}`;
  }
  if (/^[0-9a-f]{6}$/.test(body)) return `#${body}`;
  return "#64748b";
}

/**
 * Shade a hex color: amt -100 (black) … +100 (white).
 * Positive mixes toward white (tint), negative toward black (shade).
 */
export function shadeColor(hex: string, amt: number): string {
  const base = normalizeHex(hex);
  const n = parseInt(base.slice(1), 16);
  let r = (n >> 16) & 255;
  let g = (n >> 8) & 255;
  let b = n & 255;
  const t = Math.max(-100, Math.min(100, amt)) / 100;
  if (t >= 0) {
    r = Math.round(r + (255 - r) * t);
    g = Math.round(g + (255 - g) * t);
    b = Math.round(b + (255 - b) * t);
  } else {
    r = Math.round(r * (1 + t));
    g = Math.round(g * (1 + t));
    b = Math.round(b * (1 + t));
  }
  const to = (v: number) => v.toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

/** Depth tint ramp per map level (root vivid → leaves soft). */
export function levelShade(base: string, level: number, maxLevel: number): string {
  if (maxLevel <= 0) return normalizeHex(base);
  const f = level / maxLevel; // 0 … 1
  // Root: slight shade for contrast on light canvas; leaves: progressive tint.
  if (level === 0) return shadeColor(base, -12);
  return shadeColor(base, Math.round(8 + f * 62));
}

export function depthLabel(d: MindMapDepth): string {
  if (d === "overview") return "Overview";
  if (d === "tasks") return "Tasks";
  if (d === "subtasks") return "Subtasks";
  return "Full Hierarchy";
}

/** Max visible level for a depth option, adapted to root type. */
export function maxLevelForDepth(depth: MindMapDepth, rootType: "category" | "project"): number {
  if (rootType === "category") {
    if (depth === "overview") return 1;
    if (depth === "tasks") return 2;
    if (depth === "subtasks") return 3;
    return 4;
  }
  if (depth === "overview" || depth === "tasks") return 1;
  if (depth === "subtasks") return 2;
  return 3;
}

function taskType(depth: number): MindMapNodeType {
  if (depth <= 0) return "task";
  if (depth === 1) return "subtask";
  return "microtask";
}

export interface Forest {
  nodes: MindNode[];
  byKey: Map<string, MindNode>;
  children: Map<string, MindNode[]>;
  rootKeys: string[];
}

export function buildMindMapForest(args: {
  rootType: "category" | "project";
  category?: { id: number; name: string; color: string };
  projects: MindProjectInput[];
  tasks: MindTaskInput[];
  taskStatusColor?: (statusId: number) => string;
}): Forest {
  const { rootType, category, projects, tasks } = args;
  const nodes: MindNode[] = [];
  const byKey = new Map<string, MindNode>();
  const children = new Map<string, MindNode[]>();
  const push = (n: MindNode) => {
    nodes.push(n);
    byKey.set(n.key, n);
    if (n.parentKey) {
      children.set(n.parentKey, [...(children.get(n.parentKey) ?? []), n]);
    }
  };

  const projById = new Map(projects.map((p) => [p.id, p]));
  const tasksByParent = new Map<number | null, MindTaskInput[]>();
  for (const t of tasks) {
    const k = t.parent_id ?? null;
    tasksByParent.set(k, [...(tasksByParent.get(k) ?? []), t]);
  }
  const childCountOf = (taskId: number): number => {
    let n = 0;
    const stack = [...(tasksByParent.get(taskId) ?? [])];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      n++;
      stack.push(...(tasksByParent.get(cur.id) ?? []));
    }
    return n;
  };

  if (rootType === "category" && category) {
    const rootKey = `cat:${category.id}`;
    push({
      key: rootKey,
      type: "category",
      id: category.id,
      parentKey: null,
      name: category.name,
      color: normalizeHex(category.color),
      level: 0,
      childCount: projects.length,
      hasChildren: projects.length > 0,
    });
    for (const p of projects) {
      const pk = `proj:${p.id}`;
      const pTasks = tasks.filter((t) => t.project_id === p.id);
      push({
        key: pk,
        type: "project",
        id: p.id,
        projectId: p.id,
        parentKey: rootKey,
        name: p.name,
        code: p.code,
        color: normalizeHex(p.color ?? category.color),
        level: 1,
        childCount: pTasks.length,
        hasChildren: pTasks.length > 0,
      });
    }
    // Tasks attach under their project; parent chain via parent_id.
    const taskKey = (id: number) => `task:${id}`;
    // Top-level tasks first (stable order), then descendants.
    const ordered = [...tasks].sort((a, b) => a.id - b.id);
    const attached = new Set<number>();
    const attachLevel = (t: MindTaskInput): number => 2 + Math.max(0, Math.min(2, t.depth));
    // Attach in depth order so parents exist before children.
    ordered.sort((a, b) => a.depth - b.depth);
    for (const t of ordered) {
      const parentKey = t.parent_id != null && attached.has(t.parent_id) ? taskKey(t.parent_id) : `proj:${t.project_id}`;
      if (!byKey.has(parentKey) && !projById.has(t.project_id)) continue;
      const kids = tasksByParent.get(t.id) ?? [];
      push({
        key: taskKey(t.id),
        type: taskType(t.depth),
        id: t.id,
        projectId: t.project_id,
        parentKey,
        name: t.title,
        color: normalizeHex(t.status_id ? undefined : undefined) && "#64748b",
        statusId: t.status_id,
        stageId: t.stage_id ?? null,
        level: attachLevel(t),
        childCount: childCountOf(t.id),
        hasChildren: kids.length > 0,
      });
      attached.add(t.id);
    }
  } else {
    const proj = projects[0];
    if (!proj) return { nodes, byKey, children, rootKeys: [] };
    const rootKey = `proj:${proj.id}`;
    const pTasks = tasks.filter((t) => t.project_id === proj.id);
    push({
      key: rootKey,
      type: "project",
      id: proj.id,
      projectId: proj.id,
      parentKey: null,
      name: proj.name,
      code: proj.code,
      color: normalizeHex(proj.color ?? "#334155"),
      level: 0,
      childCount: pTasks.length,
      hasChildren: pTasks.length > 0,
    });
    const taskKey = (id: number) => `task:${id}`;
    const ordered = [...pTasks].sort((a, b) => a.depth - b.depth || a.id - b.id);
    const attached = new Set<number>();
    for (const t of ordered) {
      const parentKey = t.parent_id != null && attached.has(t.parent_id) ? taskKey(t.parent_id) : rootKey;
      const kids = tasksByParent.get(t.id) ?? [];
      push({
        key: taskKey(t.id),
        type: taskType(t.depth),
        id: t.id,
        projectId: t.project_id,
        parentKey,
        name: t.title,
        color: "#64748b",
        statusId: t.status_id,
        stageId: t.stage_id ?? null,
        level: 1 + Math.max(0, Math.min(2, t.depth)),
        childCount: childCountOf(t.id),
        hasChildren: kids.length > 0,
      });
      attached.add(t.id);
    }
  }

  const rootKeys = nodes.filter((n) => n.parentKey == null).map((n) => n.key);
  // Stable child order by key for deterministic layout.
  for (const [k, list] of children.entries()) {
    children.set(k, [...list].sort((a, b) => (a.code ?? a.name).localeCompare(b.code ?? b.name)));
  }
  return { nodes, byKey, children, rootKeys };
}

/** Ancestor key chain for a node (nearest parent first). */
export function ancestorKeys(key: string, byKey: Map<string, MindNode>): string[] {
  const out: string[] = [];
  let cur = byKey.get(key)?.parentKey ?? null;
  let guard = 0;
  while (cur && guard++ < 50) {
    out.push(cur);
    cur = byKey.get(cur)?.parentKey ?? null;
  }
  return out;
}

export interface PlacedNode extends MindNode {
  x: number;
  y: number;
  visible: boolean;
  dimmed: boolean;
  collapsed: boolean;
}

export const COL_X = 340;
export const ROW_H = 132;
export const NODE_W = 280;

/**
 * Tidy tree layout: leaves in DFS order, parents centered over children.
 * Horizontal: x = level * COL_X, y = order * ROW_H.
 * Vertical: x = order * COL_X, y = level * 300 (transposed).
 */
export function layoutForest(args: {
  forest: Forest;
  layout: MindMapLayout;
  maxLevel: number;
  collapsed: Set<string>;
  selectedKey?: string | null;
  matches?: Set<string>;
  /** Per-branch absolute max-level caps (Depth Badge overrides). Nearest cap on self/ancestors wins over global maxLevel. */
  branchCaps?: Map<string, number>;
}): { placed: Map<string, PlacedNode>; bounds: { w: number; h: number } } {
  const { forest, layout, maxLevel, collapsed, selectedKey, matches, branchCaps } = args;
  const { byKey, children } = forest;
  const placed = new Map<string, PlacedNode>();
  const selectedAncestors = selectedKey ? new Set(ancestorKeys(selectedKey, byKey)) : new Set<string>();

  const isHiddenByCollapse = (key: string): boolean => {
    for (const a of ancestorKeys(key, byKey)) {
      if (collapsed.has(a)) return true;
    }
    return false;
  };

  // Forced visible: selected node + its ancestors regardless of depth.
  const forced = new Set<string>();
  if (selectedKey && byKey.has(selectedKey)) {
    forced.add(selectedKey);
    for (const a of selectedAncestors) forced.add(a);
  }

  const effectiveMaxFor = (key: string): number => {
    if (!branchCaps || branchCaps.size === 0) return maxLevel;
    if (branchCaps.has(key)) return branchCaps.get(key)!;
    for (const a of ancestorKeys(key, byKey)) {
      if (branchCaps.has(a)) return branchCaps.get(a)!;
    }
    return maxLevel;
  };

  let order = 0;
  const visit = (key: string) => {
    const n = byKey.get(key);
    if (!n) return;
    const hidden = isHiddenByCollapse(key);
    const withinDepth = n.level <= effectiveMaxFor(key) || forced.has(key);
    const visible = !hidden && withinDepth;
    const dimmed = visible && matches && matches.size > 0 ? !matches.has(key) && !isAncestorOfMatch(key) : false;
    // Reserve vertical order only for visible nodes so collapsed trees compact.
    const yOrder = visible ? order++ : order;
    const x = layout === "horizontal" ? n.level * COL_X : yOrder * COL_X;
    const y = layout === "horizontal" ? yOrder * ROW_H : n.level * 300;
    placed.set(key, { ...n, x, y, visible, dimmed, collapsed: collapsed.has(key) });
    // Always recurse so off-depth / collapsed descendants still get a
    // placed entry with visible=false (callers rely on the flag, not absence).
    for (const c of children.get(key) ?? []) visit(c.key);
  };

  const isAncestorOfMatch = (key: string): boolean => {
    if (!matches || matches.size === 0) return false;
    const stack = [...(children.get(key) ?? [])];
    let guard = 0;
    while (stack.length > 0 && guard++ < 2000) {
      const cur = stack.pop()!;
      if (matches.has(cur.key)) return true;
      stack.push(...(children.get(cur.key) ?? []));
    }
    return false;
  };

  for (const r of forest.rootKeys) visit(r);

  // Center every visible parent over its visible children along the
  // ordering axis (y in horizontal, x in vertical), roots included, so the
  // top tier sits mid-left / mid-top. Single bottom-up pass: reversed
  // insertion order visits children before parents, leaves keep DFS order.
  for (const [key, p] of [...placed.entries()].reverse()) {
    const kids = (children.get(key) ?? []).map((c) => placed.get(c.key)).filter((c) => c && c.visible);
    if (kids.length === 0 || !p.visible) continue;
    const mid = kids.reduce((s, c) => s + (layout === "horizontal" ? c!.y : c!.x), 0) / kids.length;
    if (layout === "horizontal") p.y = Math.round(mid);
    else p.x = Math.round(mid);
  }

  let w = 800;
  let h = 600;
  for (const p of placed.values()) {
    if (!p.visible) continue;
    w = Math.max(w, p.x + NODE_W + 80);
    h = Math.max(h, p.y + 160);
  }
  return { placed, bounds: { w, h } };
}

/** Cubic connector between parent and child node edges. */
export function connectorPath(
  px: number,
  py: number,
  cx: number,
  cy: number,
  layout: MindMapLayout
): string {
  if (layout === "vertical") {
    const yMid = (py + 160 + cy) / 2;
    return `M ${px + NODE_W / 2} ${py + 96} C ${px + NODE_W / 2} ${yMid}, ${cx + NODE_W / 2} ${yMid}, ${cx + NODE_W / 2} ${cy}`;
  }
  const xMid = (px + NODE_W + cx) / 2;
  return `M ${px + NODE_W} ${py + 48} C ${xMid} ${py + 48}, ${xMid} ${cy + 48}, ${cx} ${cy + 48}`;
}
