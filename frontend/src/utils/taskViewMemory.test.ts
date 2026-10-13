import { beforeEach, describe, expect, it } from "vitest";
import {
  MEMORABLE_TASK_VIEWS,
  TASK_VIEW_FALLBACK,
  clearTaskViewMemory,
  isMemorableTaskView,
  normalizeTaskView,
  projectSwitchPath,
  recallTaskView,
  rememberTaskView,
  resolveTaskView,
  switchViewFor,
  taskViewFromPath,
  taskViewFromSearch,
} from "./taskViewMemory";

beforeEach(() => {
  clearTaskViewMemory();
});

describe("task view memory (01-task-view-memory)", () => {
  it("lists the six Task Views from the ticket plus kanban/status aliases", () => {
    for (const v of ["list", "board", "timeline", "table", "calendar", "dashboard"] as const) {
      expect(MEMORABLE_TASK_VIEWS).toContain(v);
    }
    expect(TASK_VIEW_FALLBACK).toBe("list");
  });

  it("extracts the view segment from project paths", () => {
    expect(taskViewFromPath("/projects/12/kanban")).toBe("kanban");
    expect(taskViewFromPath("/projects/12/timeline")).toBe("timeline");
    expect(taskViewFromPath("/projects/12")).toBeNull();
    expect(taskViewFromPath("/projects/12/")).toBeNull();
    expect(taskViewFromPath("/categories/3")).toBeNull();
    expect(taskViewFromPath("/projects")).toBeNull();
  });

  it("parses ?view= from a search string", () => {
    expect(taskViewFromSearch("?view=kanban")).toBe("kanban");
    expect(taskViewFromSearch("?view=timeline&highlight=4")).toBe("timeline");
    expect(taskViewFromSearch("?highlight=4")).toBeNull();
    expect(taskViewFromSearch("")).toBeNull();
  });

  it("never treats Mind Map View as memorable", () => {
    expect(isMemorableTaskView("mindmap")).toBe(false);
    expect(normalizeTaskView("mindmap")).toBeNull();
    expect(isMemorableTaskView("settings")).toBe(false);
    expect(isMemorableTaskView("kanban")).toBe(true);
    expect(isMemorableTaskView("bogus")).toBe(false);
  });

  it("maps the workload alias onto dashboard", () => {
    expect(normalizeTaskView("workload")).toBe("dashboard");
  });

  it("remembers memorable views and ignores mindmap/settings", () => {
    expect(recallTaskView()).toBeNull();
    rememberTaskView("kanban");
    expect(recallTaskView()).toBe("kanban");
    rememberTaskView("mindmap");
    expect(recallTaskView()).toBe("kanban");
    rememberTaskView("bogus");
    expect(recallTaskView()).toBe("kanban");
    rememberTaskView(null);
    expect(recallTaskView()).toBe("kanban");
  });

  it("never stores a role-gated view (guest dashboard falls back to list)", () => {
    rememberTaskView("dashboard", "guest");
    expect(recallTaskView()).toBeNull();
    rememberTaskView("kanban", "guest");
    expect(recallTaskView()).toBe("kanban");
  });

  it("resolves query > path > memory > list", () => {
    rememberTaskView("table");
    expect(
      resolveTaskView({ queryView: "kanban", pathSegment: "list", role: "member" })
    ).toBe("kanban");
    expect(
      resolveTaskView({ queryView: null, pathSegment: "timeline", role: "member" })
    ).toBe("timeline");
    expect(
      resolveTaskView({ queryView: null, pathSegment: null, role: "member" })
    ).toBe("table");
    expect(
      resolveTaskView({ queryView: null, pathSegment: null, role: null })
    ).toBe("table");
  });

  it("falls back to list for unknown or role-gated views", () => {
    expect(
      resolveTaskView({ queryView: "bogus", pathSegment: null, role: "member" })
    ).toBe("list");
    // Guests cannot render dashboard: memory must not leak it in.
    rememberTaskView("dashboard");
    expect(
      resolveTaskView({ queryView: null, pathSegment: null, role: "guest" })
    ).toBe("list");
    expect(
      resolveTaskView({ queryView: "dashboard", pathSegment: null, role: "guest" })
    ).toBe("list");
    // Same memory is fine for a member.
    expect(
      resolveTaskView({ queryView: null, pathSegment: null, role: "member" })
    ).toBe("dashboard");
  });

  it("builds project switch targets from memory, gated by role", () => {
    expect(projectSwitchPath(7, "member")).toBe("/projects/7/list");
    rememberTaskView("kanban");
    expect(projectSwitchPath(7, "member")).toBe("/projects/7/kanban");
    rememberTaskView("dashboard");
    expect(projectSwitchPath(7, "guest")).toBe("/projects/7/list");
    expect(projectSwitchPath("9", "manager")).toBe("/projects/9/dashboard");
  });

  it("keeps task-highlight jumps on list (highlight is a list feature)", () => {
    rememberTaskView("kanban");
    expect(projectSwitchPath(7, "member", { highlightTaskId: 42 })).toBe(
      "/projects/7/list?highlight=42"
    );
  });

  it("prefers the current URL view over memory (fresh at render time)", () => {
    rememberTaskView("table");
    expect(switchViewFor("/projects/5/kanban", "member")).toBe("kanban");
    expect(switchViewFor("/projects/5/mindmap", "member")).toBe("table");
    expect(switchViewFor("/projects", "member")).toBe("table");
    expect(switchViewFor("/categories/2", "member")).toBe("table");
    expect(switchViewFor(null, "member")).toBe("table");
    expect(projectSwitchPath(8, "member", { fromPathname: "/projects/5/kanban" })).toBe(
      "/projects/8/kanban"
    );
  });
});
