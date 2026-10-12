import { describe, expect, it } from "vitest";
import {
  ancestorKeys,
  buildMindMapForest,
  connectorPath,
  layoutForest,
  levelShade,
  maxLevelForDepth,
  normalizeHex,
  shadeColor,
} from "./mindMap";

describe("mindMap color shades", () => {
  it("normalizes short + bad hex", () => {
    expect(normalizeHex("#abc")).toBe("#aabbcc");
    expect(normalizeHex("zzz")).toBe("#64748b");
    expect(normalizeHex(null)).toBe("#64748b");
  });

  it("shades toward white/black monotonically", () => {
    const tint = shadeColor("#3366cc", 40);
    const shade = shadeColor("#3366cc", -40);
    expect(tint).not.toBe(shade);
    expect(/^#[0-9a-f]{6}$/.test(tint)).toBe(true);
    expect(/^#[0-9a-f]{6}$/.test(shade)).toBe(true);
    // Tint must be lighter (higher rgb sum) than shade.
    const sum = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).reduce((a, b) => a + b, 0);
    expect(sum(tint)).toBeGreaterThan(sum(shade));
  });

  it("ramps leaves lighter than root", () => {
    const root = levelShade("#3366cc", 0, 4);
    const leaf = levelShade("#3366cc", 4, 4);
    const sum = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).reduce((a, b) => a + b, 0);
    expect(sum(leaf)).toBeGreaterThan(sum(root));
  });
});

describe("mindMap depth caps", () => {
  it("adapts to root type", () => {
    expect(maxLevelForDepth("overview", "category")).toBe(1);
    expect(maxLevelForDepth("tasks", "category")).toBe(2);
    expect(maxLevelForDepth("full", "category")).toBe(4);
    expect(maxLevelForDepth("overview", "project")).toBe(1);
    expect(maxLevelForDepth("subtasks", "project")).toBe(2);
    expect(maxLevelForDepth("full", "project")).toBe(3);
  });
});

const projs = [
  { id: 7, code: "LAPTOP", name: "Laptop Fleet", color: "#069669" },
  { id: 8, code: "SERVER", name: "Server Cluster", color: "#0051d5" },
];
const tasks = [
  { id: 1, project_id: 7, parent_id: null, depth: 0, title: "Task A", status_id: 3, assignee_ids: [], due_date: null },
  { id: 2, project_id: 7, parent_id: 1, depth: 1, title: "Sub A.1", status_id: 3, assignee_ids: [], due_date: null },
  { id: 3, project_id: 7, parent_id: 2, depth: 2, title: "Micro A.1.1", status_id: 4, assignee_ids: [], due_date: null },
  { id: 4, project_id: 8, parent_id: null, depth: 0, title: "Task B", status_id: 5, assignee_ids: [], due_date: null },
];

describe("mindMap forest", () => {
  it("builds category root with projects + task levels", () => {
    const f = buildMindMapForest({
      rootType: "category",
      category: { id: 1, name: "Procurements", color: "#131b2e" },
      projects: projs,
      tasks,
    });
    expect(f.rootKeys).toEqual(["cat:1"]);
    expect(f.byKey.get("proj:7")?.level).toBe(1);
    expect(f.byKey.get("task:1")?.level).toBe(2);
    expect(f.byKey.get("task:2")?.level).toBe(3);
    expect(f.byKey.get("task:3")?.level).toBe(4);
    expect(f.byKey.get("task:1")?.hasChildren).toBe(true);
    expect(f.byKey.get("task:1")?.childCount).toBe(2);
  });

  it("builds project root with only that project", () => {
    const f = buildMindMapForest({ rootType: "project", projects: [projs[0]], tasks });
    expect(f.rootKeys).toEqual(["proj:7"]);
    expect(f.byKey.has("proj:8")).toBe(false);
    expect(f.byKey.get("task:1")?.level).toBe(1);
    expect(f.byKey.get("task:3")?.level).toBe(3);
  });

  it("resolves ancestor chains", () => {
    const f = buildMindMapForest({
      rootType: "category",
      category: { id: 1, name: "C", color: "#000000" },
      projects: projs,
      tasks,
    });
    expect(ancestorKeys("task:3", f.byKey)).toEqual(["task:2", "task:1", "proj:7", "cat:1"]);
  });
});

describe("mindMap layout", () => {
  it("hides past depth but forces selected path visible", () => {
    const f = buildMindMapForest({
      rootType: "category",
      category: { id: 1, name: "C", color: "#000000" },
      projects: projs,
      tasks,
    });
    const shallow = layoutForest({ forest: f, layout: "horizontal", maxLevel: 2, collapsed: new Set() });
    expect(shallow.placed.get("task:1")?.visible).toBe(true);
    expect(shallow.placed.get("task:3")?.visible).toBe(false);

    const forced = layoutForest({
      forest: f,
      layout: "horizontal",
      maxLevel: 2,
      collapsed: new Set(),
      selectedKey: "task:3",
    });
    expect(forced.placed.get("task:3")?.visible).toBe(true);
    expect(forced.placed.get("task:2")?.visible).toBe(true);
  });

  it("collapse hides descendants", () => {
    const f = buildMindMapForest({
      rootType: "category",
      category: { id: 1, name: "C", color: "#000000" },
      projects: projs,
      tasks,
    });
    const laid = layoutForest({
      forest: f,
      layout: "horizontal",
      maxLevel: 4,
      collapsed: new Set(["task:1"]),
    });
    expect(laid.placed.get("task:1")?.visible).toBe(true);
    expect(laid.placed.get("task:2")?.visible).toBe(false);
  });

  it("branch caps override global depth per branch", () => {
    const f = buildMindMapForest({
      rootType: "category",
      category: { id: 1, name: "C", color: "#000000" },
      projects: projs,
      tasks,
    });
    // Global L2 hides Sub/Micro everywhere.
    const base = layoutForest({ forest: f, layout: "horizontal", maxLevel: 2, collapsed: new Set() });
    expect(base.placed.get("task:2")?.visible).toBe(false);
    // Ticking proj:7 to L4 reveals its branch only; proj:8 branch stays hidden.
    const ticked = layoutForest({
      forest: f,
      layout: "horizontal",
      maxLevel: 2,
      collapsed: new Set(),
      branchCaps: new Map([["proj:7", 4]]),
    });
    expect(ticked.placed.get("task:2")?.visible).toBe(true);
    expect(ticked.placed.get("task:3")?.visible).toBe(true);
  });

  it("emits cubic connectors for both layouts", () => {
    expect(connectorPath(0, 0, 340, 132, "horizontal")).toContain("C");
    expect(connectorPath(0, 0, 340, 300, "vertical")).toContain("C");
  });
});
