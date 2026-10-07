import { describe, it, expect } from "vitest";
import { buildChildrenMap, getVisibleTreeTasks, getDescendantStats, getSubtreeDateRange, getWbsNumber, TreeTask } from "./wbsTree";

describe("wbsTree utils", () => {
  const sampleTasks: TreeTask[] = [
    { task_id: 1, depth: 0, parent_id: null, title: "Task 1", status_id: 10, status_name: "Open", start_date: "2026-03-01", due_date: "2026-03-05", position: 1, assignee_ids: [], is_blocked: false, periods: [] },
    { task_id: 2, depth: 1, parent_id: 1, title: "Subtask 1.1", status_id: 10, status_name: "Open", start_date: "2026-03-02", due_date: "2026-03-04", position: 1, assignee_ids: [], is_blocked: false, periods: [] },
    { task_id: 3, depth: 2, parent_id: 2, title: "Microtask 1.1.1", status_id: 11, status_name: "Done", start_date: "2026-03-02", due_date: "2026-03-03", position: 1, assignee_ids: [], is_blocked: false, periods: [] },
    { task_id: 4, depth: 0, parent_id: null, title: "Task 2", status_id: 10, status_name: "Open", start_date: "2026-03-06", due_date: "2026-03-10", position: 2, assignee_ids: [], is_blocked: false, periods: [] },
  ];

  const statuses = [
    { id: 10, is_done: false },
    { id: 11, is_done: true },
  ];

  it("builds children map correctly", () => {
    const map = buildChildrenMap(sampleTasks);
    expect(map.get(null)?.length).toBe(2);
    expect(map.get(1)?.length).toBe(1);
    expect(map.get(2)?.length).toBe(1);
  });

  it("filters visible tree tasks based on treeDefault and collapsed state", () => {
    // all visible
    const all = getVisibleTreeTasks(sampleTasks, "all", new Set());
    expect(all.map((t) => t.task_id)).toEqual([1, 2, 3, 4]);

    // tasks-only
    const tasksOnly = getVisibleTreeTasks(sampleTasks, "tasks-only", new Set());
    expect(tasksOnly.map((t) => t.task_id)).toEqual([1, 4]);

    // tasks-subtasks
    const tasksSubtasks = getVisibleTreeTasks(sampleTasks, "tasks-subtasks", new Set());
    expect(tasksSubtasks.map((t) => t.task_id)).toEqual([1, 2, 4]);

    // collapsed Task 1
    const collapsed = getVisibleTreeTasks(sampleTasks, "all", new Set([1]));
    expect(collapsed.map((t) => t.task_id)).toEqual([1, 4]);
  });

  it("computes descendant stats and subtree date range", () => {
    const map = buildChildrenMap(sampleTasks);
    const stats = getDescendantStats(1, map, statuses);
    expect(stats.total).toBe(2);
    expect(stats.completed).toBe(1);

    const range = getSubtreeDateRange(1, sampleTasks[0], map);
    expect(range.start).toBe("2026-03-01");
    expect(range.due).toBe("2026-03-05");
  });

  it("computes WBS numbers correctly", () => {
    expect(getWbsNumber(0, sampleTasks)).toBe("1");
    expect(getWbsNumber(1, sampleTasks)).toBe("1.1");
    expect(getWbsNumber(2, sampleTasks)).toBe("1.1.1");
    expect(getWbsNumber(3, sampleTasks)).toBe("2");
  });
});
