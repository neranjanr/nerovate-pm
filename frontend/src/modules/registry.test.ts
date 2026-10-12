import { describe, expect, it } from "vitest";
import { allowedViews, canAccessView } from "./registry";

const ids = (role: Parameters<typeof allowedViews>[0]) =>
  allowedViews(role).map((e) => e.id);

describe("registry role gating (SPEC-v0.2 section 3)", () => {
  it("guest sees only board + kanban + list + status + mindmap", () => {
    expect(ids("guest").sort()).toEqual(["board", "kanban", "list", "mindmap", "status"]);
  });

  it("member sees board/kanban/list/calendar/table/timeline/dashboard, no workload/settings", () => {
    const got = ids("member");
    for (const v of ["board", "kanban", "list", "calendar", "table", "timeline", "dashboard"]) {
      expect(got).toContain(v);
    }
    expect(got).not.toContain("workload");
    expect(got).not.toContain("settings");
  });

  it("manager sees workload + settings tabs (settings additionally membership-gated backend)", () => {
    expect(canAccessView("manager", "workload")).toBe(true);
    expect(canAccessView("manager", "settings")).toBe(true);
    expect(canAccessView("manager", "calendar")).toBe(true);
  });

  it("admin sees workload + settings", () => {
    expect(canAccessView("admin", "workload")).toBe(true);
    expect(canAccessView("admin", "settings")).toBe(true);
  });

  it("every entry declares requiredRole (modularity contract)", async () => {
    const { REGISTRY } = await import("./registry");
    for (const e of REGISTRY) {
      expect(e.requiredRole.length).toBeGreaterThan(0);
      expect(e.route.length).toBeGreaterThan(0);
    }
  });
});
