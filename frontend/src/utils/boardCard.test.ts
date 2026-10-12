import { describe, expect, it } from "vitest";
import { formatTaskCode, boardStatusMoveBody } from "./boardCard";

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
});
