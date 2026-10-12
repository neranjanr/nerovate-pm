/** Session idle-timeout seam (15-minute policy). Pure helpers — tested in sessionIdle.test.ts. */

export const IDLE_TIMEOUT_MS = 15 * 60 * 1000;
export const IDLE_CHECK_MS = 10 * 1000;
export const ACTIVITY_WRITE_THROTTLE_MS = 2 * 1000;

export const LAST_ACTIVITY_KEY = "nv_last_activity";
export const SESSION_EXPIRED_KEY = "nv_session_expired";

/** True when `now - lastActivity` reaches the idle timeout. NaN/0 lastActivity counts as expired. */
export function isIdleExpired(lastActivity: number, now: number, timeoutMs: number = IDLE_TIMEOUT_MS): boolean {
  if (!Number.isFinite(lastActivity) || lastActivity <= 0) return true;
  return now - lastActivity >= timeoutMs;
}

export function readLastActivity(store: Pick<Storage, "getItem">): number {
  return Number(store.getItem(LAST_ACTIVITY_KEY) ?? 0);
}

export function writeLastActivity(store: Pick<Storage, "setItem">, now: number = Date.now()): void {
  try {
    store.setItem(LAST_ACTIVITY_KEY, String(now));
  } catch {
    // storage unavailable (private mode); in-memory timer still guards this tab.
  }
}

export function markSessionExpired(store: Pick<Storage, "setItem">): void {
  try {
    store.setItem(SESSION_EXPIRED_KEY, "1");
  } catch {
    // ignore
  }
}

/** Reads + clears the expired flag (one-shot login notice). */
export function consumeSessionExpired(store: Pick<Storage, "getItem" | "removeItem">): boolean {
  try {
    const v = store.getItem(SESSION_EXPIRED_KEY);
    if (v) store.removeItem(SESSION_EXPIRED_KEY);
    return v === "1";
  } catch {
    return false;
  }
}
