import { describe, expect, it } from "vitest";
import { buildTaskQuery, EMPTY_FILTERS } from "./TaskFilters";

describe("T8 shared task filters parity", () => {
  it("builds one query string reused by list/calendar/table", () => {
    const q = buildTaskQuery("7", {
      ...EMPTY_FILTERS,
      search: "apples",
      statusId: "3",
      assigneeId: "9",
      watcherId: "11",
      tag: "backend",
      depth: "1",
      blocked: "true",
      overdue: "true",
    });
    expect(q).toContain("project_id=7");
    expect(q).toContain("search=apples");
    expect(q).toContain("status=3");
    expect(q).toContain("assignee=9");
    expect(q).toContain("watcher=11");
    expect(q).toContain("tag=backend");
    expect(q).toContain("depth=1");
    expect(q).toContain("blocked=true");
    expect(q).toContain("overdue=true");
  });

  it("omits empty filters", () => {
    expect(buildTaskQuery("7", { ...EMPTY_FILTERS })).toBe("project_id=7");
  });
});
