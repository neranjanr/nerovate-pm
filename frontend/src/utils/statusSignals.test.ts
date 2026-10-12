import { describe, expect, it } from "vitest";
import {
  KIND_LABELS,
  STATUS_KINDS,
  deriveStatusSignal,
  normalizeKind,
  stageAverage,
  statusGlyph,
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
