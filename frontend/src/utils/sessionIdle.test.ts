import { describe, expect, it } from "vitest";
import {
  IDLE_TIMEOUT_MS,
  consumeSessionExpired,
  isIdleExpired,
  markSessionExpired,
} from "./sessionIdle";

function memStore() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

describe("session idle timeout (15 min policy)", () => {
  it("expires at exactly 15 minutes", () => {
    const now = 1_000_000;
    expect(isIdleExpired(now - IDLE_TIMEOUT_MS, now)).toBe(true);
    expect(isIdleExpired(now - IDLE_TIMEOUT_MS + 1, now)).toBe(false);
    expect(isIdleExpired(now - 60_000, now)).toBe(false);
  });

  it("treats missing/zero activity as expired", () => {
    expect(isIdleExpired(0, Date.now())).toBe(true);
    expect(isIdleExpired(NaN, Date.now())).toBe(true);
  });

  it("expired flag is one-shot", () => {
    const s = memStore();
    expect(consumeSessionExpired(s)).toBe(false);
    markSessionExpired(s);
    expect(consumeSessionExpired(s)).toBe(true);
    expect(consumeSessionExpired(s)).toBe(false);
  });
});
