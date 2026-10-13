import { describe, expect, it } from "vitest";
import { displayAnchor, fromDueInput, repeatLabel, toDueInput } from "./reminders";

describe("repeatLabel", () => {
  it("labels one-time", () => {
    expect(repeatLabel({ repeat: "none", repeat_end: "never", repeat_after_n: null, repeat_until: null })).toBe("One-time");
  });
  it("labels ongoing and bounded cadences", () => {
    expect(repeatLabel({ repeat: "daily", repeat_end: "never", repeat_after_n: null, repeat_until: null })).toBe("Daily · ongoing");
    expect(repeatLabel({ repeat: "yearly", repeat_end: "after", repeat_after_n: 5, repeat_until: null })).toBe("Yearly · ends after 5");
    expect(repeatLabel({ repeat: "weekly", repeat_end: "until", repeat_after_n: null, repeat_until: "2030-03-05" })).toBe("Weekly · until 2030-03-05");
  });
});

describe("displayAnchor", () => {
  it("prefers the live anchor, falls back to kept ex-anchor title", () => {
    expect(displayAnchor({ anchor_title: "Buy server", ex_anchor_title: "", is_detached: false })).toBe("Buy server");
    expect(displayAnchor({ anchor_title: null, ex_anchor_title: "Buy server", is_detached: true })).toBe("Buy server (detached)");
    expect(displayAnchor({ anchor_title: null, ex_anchor_title: "", is_detached: true })).toBe("Detached");
  });
});

describe("due inputs", () => {
  it("round-trips date-only and datetime values", () => {
    expect(toDueInput("2031-06-01T09:00:00")).toEqual({ date: "2031-06-01", time: "09:00" });
    expect(toDueInput("2031-06-01")).toEqual({ date: "2031-06-01", time: "" });
    expect(fromDueInput("2031-06-01", "")).toBe("2031-06-01");
    expect(fromDueInput("2031-06-01", "09:00")).toBe("2031-06-01T09:00:00");
  });
});
