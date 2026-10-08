import { describe, it, expect } from "vitest";
import {
  canDropAsSiblings,
  getSiblingPosition,
  formatReorderConfirm,
  getReorderDisabledReason,
  type TreeTask,
} from "./wbsTree";

function task(over: Partial<TreeTask> & { task_id: number }): TreeTask {
  return {
    title: `T${over.task_id}`,
    depth: 0,
    parent_id: null,
    status_id: 1,
    status_name: "Open",
    start_date: "2026-01-01",
    assignee_ids: [],
    is_blocked: false,
    periods: [],
    ...over,
  };
}

describe("V4 drag-confirm seams", () => {
  it("allows same-parent drops, blocks cross-parent and self", () => {
    const a = task({ task_id: 1, parent_id: null });
    const b = task({ task_id: 2, parent_id: null });
    const s1 = task({ task_id: 3, parent_id: 1, depth: 1 });
    const s2 = task({ task_id: 4, parent_id: 1, depth: 1 });
    const other = task({ task_id: 5, parent_id: 2, depth: 1 });

    expect(canDropAsSiblings(a, b)).toBe(true);
    expect(canDropAsSiblings(s1, s2)).toBe(true);
    expect(canDropAsSiblings(s1, other)).toBe(false);
    expect(canDropAsSiblings(a, s1)).toBe(false);
    expect(canDropAsSiblings(a, a)).toBe(false);
  });

  it("resolves sibling position from stored position or sibling order", () => {
    const a = task({ task_id: 1, position: 2 });
    const b = task({ task_id: 2, position: 1 });
    expect(getSiblingPosition(a, [a, b])).toBe(2);
    expect(getSiblingPosition(b, [a, b])).toBe(1);

    const c = task({ task_id: 3 });
    const d = task({ task_id: 4 });
    expect(getSiblingPosition(c, [c, d])).toBe(1);
    expect(getSiblingPosition(d, [c, d])).toBe(2);
  });

  it("formats confirm copy as WBS 'Title': position A -> B", () => {
    expect(formatReorderConfirm("1.2", "Alpha", 2, 4)).toBe("1.2 'Alpha': position 2 → 4");
  });

  it("disables drag for guests and when filtered", () => {
    expect(getReorderDisabledReason("guest", false)).toBe("Guest cannot reorder tasks");
    expect(getReorderDisabledReason("guest", true)).toBe("Guest cannot reorder tasks");
    expect(getReorderDisabledReason("member", true)).toBe(
      "Drag disabled while filters/search/depth active"
    );
    expect(getReorderDisabledReason("member", false)).toBeNull();
    expect(getReorderDisabledReason("admin", false)).toBeNull();
  });
});
