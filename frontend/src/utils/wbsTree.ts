export interface StatusPeriod {
  id: number;
  task_id: number;
  status_id: number;
  start_date?: string | null;
  due_date?: string | null;
  actual_end_date?: string | null;
  actor_id?: number | null;
  created_at: string;
}

export interface TreeAssignee {
  id: number;
  name?: string;
  username?: string;
}

export interface TreeTask {
  task_id: number;
  title: string;
  depth: number;
  parent_id?: number | null;
  // ADR-0010: null when directly assigned onto an empty Stage (see stage_id).
  status_id: number | null;
  stage_id?: number | null;
  status_name: string;
  start_date: string;
  due_date?: string | null;
  assignee_ids: number[];
  assignees?: TreeAssignee[];
  priority?: string;
  is_blocked: boolean;
  position?: number;
  wbs?: string;
  periods: StatusPeriod[];
}

export function buildChildrenMap(tasks: TreeTask[]) {
  const map = new Map<number | null, TreeTask[]>();
  for (const t of tasks) {
    const pid = t.parent_id ?? null;
    if (!map.has(pid)) map.set(pid, []);
    map.get(pid)!.push(t);
  }
  for (const [pid, list] of map.entries()) {
    list.sort((a, b) => {
      const posA = a.position ?? 0;
      const posB = b.position ?? 0;
      if (posA !== posB) return posA - posB;
      return a.task_id - b.task_id;
    });
  }
  return map;
}

export function getSubtreeTasks(taskId: number, childrenMap: Map<number | null, TreeTask[]>): TreeTask[] {
  const res: TreeTask[] = [];
  const kids = childrenMap.get(taskId) || [];
  for (const k of kids) {
    res.push(k);
    res.push(...getSubtreeTasks(k.task_id, childrenMap));
  }
  return res;
}

export function getDescendantStats(
  taskId: number,
  childrenMap: Map<number | null, TreeTask[]>,
  statuses: Array<{ id: number; is_done?: boolean }>
) {
  const descendants = getSubtreeTasks(taskId, childrenMap);
  const total = descendants.length;
  const completed = descendants.filter((d) => {
    const st = statuses.find((s) => s.id === d.status_id);
    return st?.is_done;
  }).length;
  return { total, completed, descendants };
}

export function getSubtreeDateRange(taskId: number, task: TreeTask, childrenMap: Map<number | null, TreeTask[]>) {
  const descendants = getSubtreeTasks(taskId, childrenMap);
  const allItems = [task, ...descendants];
  const starts = allItems.map((t) => t.start_date).filter(Boolean).sort();
  const dues = allItems.map((t) => t.due_date).filter(Boolean).sort();
  return {
    start: starts[0] || task.start_date,
    due: dues[dues.length - 1] || task.due_date || null,
  };
}

export function getVisibleTreeTasks(
  tasks: TreeTask[],
  treeDefault: "tasks-only" | "tasks-subtasks" | "all",
  collapsedIds: Set<number>
): TreeTask[] {
  const childrenMap = buildChildrenMap(tasks);
  const result: TreeTask[] = [];

  function traverse(pid: number | null) {
    const kids = childrenMap.get(pid) || [];
    for (const kid of kids) {
      if (treeDefault === "tasks-only" && kid.depth > 0) continue;
      if (treeDefault === "tasks-subtasks" && kid.depth > 1) continue;

      result.push(kid);

      const isCollapsed = collapsedIds.has(kid.task_id);
      if (!isCollapsed) {
        traverse(kid.task_id);
      }
    }
  }

  traverse(null);
  return result;
}

/** V4: same-parent drop validation — Tasks among Tasks, Subtasks among same-Task siblings, Microtasks among same-Subtask siblings. */
export function canDropAsSiblings(
  dragged: Pick<TreeTask, "task_id" | "parent_id">,
  target: Pick<TreeTask, "task_id" | "parent_id">
): boolean {
  if (dragged.task_id === target.task_id) return false;
  return (dragged.parent_id ?? null) === (target.parent_id ?? null);
}

/** V4: 1-based sibling rank, prefers stored position, falls back to sibling order. */
export function getSiblingPosition(task: TreeTask, allTasks: TreeTask[]): number {
  if (typeof task.position === "number" && task.position > 0) return task.position;
  const siblings = allTasks.filter((t) => (t.parent_id ?? null) === (task.parent_id ?? null));
  return siblings.indexOf(task) + 1;
}

/** V4: Confirm modal copy `WBS 'Title': position A -> B`. */
export function formatReorderConfirm(wbs: string, title: string, oldPos: number, newPos: number): string {
  return `${wbs} '${title}': position ${oldPos} → ${newPos}`;
}

/** V4: drag disabled reason — guest role or any filter/search/depth active. Null when reorder allowed. */
export function getReorderDisabledReason(role: string | null | undefined, isFiltered: boolean): string | null {
  if (role === "guest") return "Guest cannot reorder tasks";
  if (isFiltered) return "Drag disabled while filters/search/depth active";
  return null;
}

export function getWbsNumber(index: number, taskList: TreeTask[]): string {
  const task = taskList[index];
  if (!task) return `${index + 1}`;
  if (task.depth === 0) {
    let count = 0;
    for (let i = 0; i <= index; i++) {
      if (taskList[i].depth === 0) count++;
    }
    return `${count}`;
  }
  if (task.depth === 1) {
    const parent = taskList.slice(0, index).reverse().find((t) => t.depth === 0);
    const parentIdx = parent ? taskList.indexOf(parent) : 0;
    const parentWbs: string = getWbsNumber(parentIdx, taskList);
    let subCount = 0;
    for (let i = 0; i <= index; i++) {
      if (taskList[i].depth === 1 && taskList[i].parent_id === task.parent_id) {
        subCount++;
      }
    }
    return `${parentWbs}.${subCount}`;
  }
  if (task.depth === 2) {
    const parent = taskList.slice(0, index).reverse().find((t) => t.depth === 1);
    const parentIdx = parent ? taskList.indexOf(parent) : 0;
    const parentWbs: string = parent ? getWbsNumber(parentIdx, taskList) : "1.1";
    let microCount = 0;
    for (let i = 0; i <= index; i++) {
      if (taskList[i].depth === 2 && taskList[i].parent_id === task.parent_id) {
        microCount++;
      }
    }
    return `${parentWbs}.${microCount}`;
  }
  return `${index + 1}`;
}
