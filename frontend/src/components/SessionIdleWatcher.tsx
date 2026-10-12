import { useEffect, useRef } from "react";
import { useAuth } from "../stores/auth";
import {
  ACTIVITY_WRITE_THROTTLE_MS,
  IDLE_CHECK_MS,
  IDLE_TIMEOUT_MS,
  LAST_ACTIVITY_KEY,
  isIdleExpired,
  markSessionExpired,
  writeLastActivity,
} from "../utils/sessionIdle";

const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "touchstart", "scroll", "wheel"] as const;

/**
 * 15-minute idle watchdog. Mount once inside the Router + AuthProvider tree.
 * - Any activity bumps `nv_last_activity` (shared across tabs, throttled).
 * - Every 10s each tab checks staleness; on expiry it logs out and hard-loads
 *   `/login`, which unmounts every drawer/modal/route ("close and load login").
 */
export default function SessionIdleWatcher() {
  const auth = useAuth();
  const tokenRef = useRef(auth.accessToken);
  tokenRef.current = auth.accessToken;
  const logoutRef = useRef(auth.logout);
  logoutRef.current = auth.logout;

  useEffect(() => {
    if (!tokenRef.current) return;
    // Fresh login / reload counts as activity.
    writeLastActivity(localStorage);

    let lastWrite = Date.now();
    const bump = () => {
      if (!tokenRef.current) return;
      const now = Date.now();
      if (now - lastWrite < ACTIVITY_WRITE_THROTTLE_MS) return;
      lastWrite = now;
      writeLastActivity(localStorage, now);
    };

    const expire = () => {
      if (!tokenRef.current) return;
      try {
        logoutRef.current();
        localStorage.removeItem(LAST_ACTIVITY_KEY);
        markSessionExpired(sessionStorage);
      } finally {
        // Hard navigation: guarantees every open drawer/modal/route unmounts.
        window.location.href = "/login?expired=1";
      }
    };

    const check = () => {
      if (!tokenRef.current) return;
      const last = Number(localStorage.getItem(LAST_ACTIVITY_KEY) ?? 0);
      if (isIdleExpired(last, Date.now(), IDLE_TIMEOUT_MS)) expire();
    };

    // Cross-tab: activity in another tab extends this tab's session.
    const onStorage = (e: StorageEvent) => {
      if (e.key === LAST_ACTIVITY_KEY && e.newValue) lastWrite = Number(e.newValue) || Date.now();
    };

    for (const ev of ACTIVITY_EVENTS) window.addEventListener(ev, bump, { passive: true, capture: true });
    window.addEventListener("storage", onStorage);
    const timer = window.setInterval(check, IDLE_CHECK_MS);
    // Immediate check in case the tab slept past the deadline.
    check();
    return () => {
      for (const ev of ACTIVITY_EVENTS) window.removeEventListener(ev, bump, { capture: true });
      window.removeEventListener("storage", onStorage);
      window.clearInterval(timer);
    };
  }, [auth.accessToken]);

  return null;
}
