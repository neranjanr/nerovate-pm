import { describe, expect, it } from "vitest";
import {
  KIND_LABELS,
  STATUS_KINDS,
  buildStatusDropdownSections,
  deriveStatusSignal,
  emptyStageSignal,
  isEmptyStage,
  normalizeKind,
  parseStatusSelection,
  stageAverage,
  statusGlyph,
  statusSelectionValue,
  statusWeight,
} from "./statusSignals";

describe("statusWeight", () => {
  it("maps first to 0% and last to 100% within its own Stage", () => {
    expect(statusWeight(0, 2)).toBe(0);
    expect(statusWeight(1, 2)).toBe(100);
    expect([0, 1, 2, 3, 4].map((i) => statusWeight(i, 5))).toEqual([0, 25, 50, 75, 100]);
  });

  it("steps a 15-Status Stage as 0, 7, 14, ..., 100", () => {
    expect(Array.from({ length: 15 }, (_, i) => statusWeight(i, 15))).toEqual([
      0, 7, 14, 21, 29, 36, 43, 50, 57, 64, 71, 79, 86, 93, 100,
    ]);
  });

  it("shows 100% for a single-Status Stage", () => {
    expect(statusWeight(0, 1)).toBe(100);
  });
});

describe("statusGlyph", () => {
  it("walks a monotonic five-step ramp", () => {
    expect([0, 1, 2, 3, 4].map((i) => statusGlyph(i, 5))).toEqual(["○", "◔", "◑", "◕", "●"]);
    const ramp = ["○", "◔", "◑", "◕", "●"];
    const glyphs = Array.from({ length: 15 }, (_, i) => statusGlyph(i, 15));
    expect(glyphs[0]).toBe("○");
    expect(glyphs[glyphs.length - 1]).toBe("●");
    const buckets = glyphs.map((g) => ramp.indexOf(g));
    expect([...buckets].sort((a, b) => a - b)).toEqual(buckets);
  });

  it("keeps percent on kind overrides and forces check for done", () => {
    for (const kind of ["on_hold", "blocked", "attention", "cancelled"]) {
      const sig = deriveStatusSignal(3, 5, kind);
      expect(sig.weight).toBe(75);
      expect(sig.glyph).not.toBe(statusGlyph(3, 5));
    }
    expect(deriveStatusSignal(0, 5, "blocked", true).glyph).toBe("✓");
    expect(deriveStatusSignal(0, 5, "normal", true).weight).toBe(0);
  });

  it("rejects unknown kinds", () => {
    expect(() => normalizeKind("frozen")).toThrow();
  });

  it("labels every kind for assistive tech", () => {
    for (const kind of STATUS_KINDS) expect(KIND_LABELS[kind]).toBeTruthy();
    expect(KIND_LABELS.done).toBeTruthy();
  });
});

describe("stageAverage", () => {
  it("rounds the mean weight, 0 when empty", () => {
    expect(stageAverage([0, 100])).toBe(50);
    expect(stageAverage([])).toBe(0);
  });
});

describe("emptyStageSignal", () => {
  it("renders an empty Stage as a single node at full glyph and percent", () => {
    expect(emptyStageSignal()).toEqual({ glyph: "●", weight: 100 });
    const single = deriveStatusSignal(0, 1);
    expect(emptyStageSignal()).toEqual({ glyph: single.glyph, weight: single.weight });
  });
});

describe("buildStatusDropdownSections", () => {
  const stages = [
    { id: 1, name: "Solo", order: 1 },
    { id: 2, name: "Grouped", order: 2 },
  ];
  const statuses = [
    { id: 11, name: "First", order: 1, stage_id: 2 },
    { id: 12, name: "Second", order: 2, stage_id: 2 },
    { id: 13, name: "Legacy", order: 3, stage_id: null },
  ];

  it("renders empty Stages as selectable rows and non-empty Stages as groups", () => {
    const sections = buildStatusDropdownSections(stages, statuses);
    expect(sections[0]).toMatchObject({ kind: "stage-row", stageId: 1, value: "stage:1" });
    if (sections[0].kind === "stage-row") {
      expect(sections[0].label).toContain("● 100%");
    }
    expect(sections[1]).toMatchObject({ kind: "group", stageId: 2, stageName: "Grouped" });
    if (sections[1].kind === "group") {
      expect(sections[1].leaves.map((l) => l.value)).toEqual(["status:11", "status:12"]);
    }
    expect(sections[2]).toMatchObject({ kind: "leaf", value: "status:13" });
  });

  it("orders sections and leaves by order", () => {
    const sections = buildStatusDropdownSections(
      [...stages].reverse(),
      [...statuses].reverse()
    );
    expect(sections[0]).toMatchObject({ kind: "stage-row", stageId: 1 });
    if (sections[1].kind === "group") {
      expect(sections[1].leaves.map((l) => l.statusId)).toEqual([11, 12]);
    }
  });

  it("detects empty Stages", () => {
    expect(isEmptyStage(1, statuses)).toBe(true);
    expect(isEmptyStage(2, statuses)).toBe(false);
  });

  it("round-trips selections and rejects garbage", () => {
    expect(parseStatusSelection("stage:1")).toEqual({ kind: "stage", stageId: 1 });
    expect(parseStatusSelection("status:12")).toEqual({ kind: "status", statusId: 12 });
    expect(parseStatusSelection("")).toBeNull();
    expect(parseStatusSelection("11")).toBeNull();
    expect(parseStatusSelection("__header:2")).toBeNull();
    expect(statusSelectionValue({ kind: "stage", stageId: 1 })).toBe("stage:1");
    expect(statusSelectionValue({ kind: "status", statusId: 12 })).toBe("status:12");
    expect(statusSelectionValue(null)).toBe("");
  });
});
