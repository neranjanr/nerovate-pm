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

export interface TreeTask {
  task_id: number;
  title: string;
  depth: number;
  parent_id?: number | null;
  status_id: number;
  status_name: string;
  start_date: string;
  due_date?: string | null;
  assignee_ids: number[];
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
