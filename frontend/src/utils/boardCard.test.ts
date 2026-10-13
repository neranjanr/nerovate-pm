import { describe, expect, it } from "vitest";
import { formatTaskCode, boardStageMoveBody, boardStatusMoveBody, resolveStageDrop } from "./boardCard";

describe("slice 4 board card seam", () => {
  it("prefers WBS code, falls back to #id", () => {
    expect(formatTaskCode({ id: 7, wbs: "1.2" })).toBe("1.2");
    expect(formatTaskCode({ id: 7, wbs: "" })).toBe("#7");
    expect(formatTaskCode({ id: 7 })).toBe("#7");
  });

  it("dates the status move with today so periods record history", () => {
    expect(boardStatusMoveBody(3, "2026-03-05")).toEqual({
      status_id: 3,
      start_date: "2026-03-05",
    });
  });

  it("moves onto an empty Stage with a stage-only body", () => {
    expect(boardStageMoveBody(9)).toEqual({ stage_id: 9 });
  });

  describe("issue 02 stage-drop resolution", () => {
    it("resolves an explicit leaf even when filtered", () => {
      expect(
        resolveStageDrop({ leafIds: [1, 2], leafId: 2, filtersActive: true })
      ).toEqual({ kind: "explicit-move", statusId: 2 });
    });

    it("resolves an empty Stage to a direct assignment", () => {
      expect(resolveStageDrop({ leafIds: [], filtersActive: false })).toEqual({
        kind: "direct-stage",
      });
    });

    it("blocks ambiguous non-empty drops while filtered", () => {
      expect(resolveStageDrop({ leafIds: [1], filtersActive: true })).toEqual({
        kind: "blocked-filtered",
      });
      expect(
        resolveStageDrop({ leafIds: [1, 2], filtersActive: true })
      ).toEqual({ kind: "blocked-filtered" });
    });

    it("resolves a single leaf deterministically when unfiltered", () => {
      expect(resolveStageDrop({ leafIds: [7], filtersActive: false })).toEqual({
        kind: "explicit-move",
        statusId: 7,
      });
    });

    it("forces a picker for multi-leaf stages instead of silent first-pick", () => {
      expect(
        resolveStageDrop({ leafIds: [4, 5, 6], filtersActive: false })
      ).toEqual({ kind: "force-picker", choices: [4, 5, 6] });
    });
  });
});
