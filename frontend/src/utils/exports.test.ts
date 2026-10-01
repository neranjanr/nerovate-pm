import { describe, expect, it } from "vitest";
import {
  buildDashboardExportUrl,
  buildTimelineExportUrl,
  filterByDepth,
  ganttMinWidth,
  pxPerDay,
} from "./exports";

describe("t9 export helpers", () => {
  it("pxPerDay compresses coarser grains", () => {
    expect(pxPerDay("day")).toBeGreaterThan(pxPerDay("week"));
    expect(pxPerDay("week")).toBeGreaterThan(pxPerDay("month"));
    expect(pxPerDay("month")).toBeGreaterThan(pxPerDay("quarter"));
  });

  it("ganttMinWidth shrinks with coarser grains", () => {
    expect(ganttMinWidth("day")).toBeGreaterThanOrEqual(ganttMinWidth("week"));
    expect(ganttMinWidth("week")).toBeGreaterThanOrEqual(ganttMinWidth("month"));
  });

  it("filterByDepth keeps only the selected depth", () => {
    const tasks = [{ depth: 0 }, { depth: 1 }, { depth: 2 }, { depth: 1 }];
    expect(filterByDepth(tasks, "1")).toEqual([{ depth: 1 }, { depth: 1 }]);
    expect(filterByDepth(tasks, "all")).toEqual(tasks);
    expect(filterByDepth(tasks, "")).toEqual(tasks);
  });

  it("timeline export url carries depth only when concrete", () => {
    expect(buildTimelineExportUrl("7", "json", "all")).toBe(
      "/api/v1/tasks/timeline/export?project_id=7&format=json"
    );
    expect(buildTimelineExportUrl("7", "csv", "2")).toBe(
      "/api/v1/tasks/timeline/export?project_id=7&format=csv&depth=2"
    );
  });

  it("dashboard export url is well-formed", () => {
    expect(buildDashboardExportUrl("7", "json")).toBe(
      "/api/v1/dashboard/export?project_id=7&format=json"
    );
  });
});
