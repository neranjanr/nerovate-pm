/** Reminder (CONTEXT.md) frontend types + pure helpers (tickets 04–06). */

export interface Reminder {
  id: number;
  title: string;
  note: string;
  due_at: string;
  status: string;
  project_id: number | null;
  task_id: number | null;
  anchor_project_id: number | null;
  anchor_title: string | null;
  ex_anchor_title: string;
  ex_anchor_project_id: number | null;
  is_detached: boolean;
  detached_at: string | null;
  repeat: string;
  repeat_end: string;
  repeat_after_n: number | null;
  repeat_until: string | null;
  occurrence_index: number;
  snoozed_until: string | null;
  is_overdue: boolean;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

export const REPEATS = ["none", "daily", "weekly", "monthly", "yearly"] as const;
export const REPEAT_ENDS = ["never", "after", "until"] as const;

/** Human cadence: "One-time", "Daily", "Weekly · ends after 3", … */
export function repeatLabel(r: Pick<Reminder, "repeat" | "repeat_end" | "repeat_after_n" | "repeat_until">): string {
  const rep = (r.repeat || "none").toLowerCase();
  if (rep === "none") return "One-time";
  const base = rep.charAt(0).toUpperCase() + rep.slice(1);
  if ((r.repeat_end || "never").toLowerCase() === "after" && r.repeat_after_n) {
    return `${base} · ends after ${r.repeat_after_n}`;
  }
  if ((r.repeat_end || "never").toLowerCase() === "until" && r.repeat_until) {
    return `${base} · until ${r.repeat_until.slice(0, 10)}`;
  }
  return `${base} · ongoing`;
}

/** Anchor display: live anchor title, else kept ex-anchor title (detached). */
export function displayAnchor(r: Pick<Reminder, "anchor_title" | "ex_anchor_title" | "is_detached">): string {
  if (r.anchor_title) return r.anchor_title;
  if (r.ex_anchor_title) return `${r.ex_anchor_title} (detached)`;
  return r.is_detached ? "Detached" : "—";
}

/** Split a due value for date/time inputs. */
export function toDueInput(dueAt: string): { date: string; time: string } {
  const v = (dueAt || "").trim();
  if (!v) return { date: "", time: "" };
  const m = v.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);
  if (m) return { date: m[1], time: m[2] };
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return { date: v, time: "" };
  return { date: v.slice(0, 10), time: "" };
}

/** Date-only stays date-only (backend defaults 09:00 server-local). */
export function fromDueInput(date: string, time: string): string {
  if (time) return `${date}T${time}:00`;
  return date;
}

export async function api<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      Authorization: `Bearer ${token}`,
      ...(init?.headers || {}),
    },
  });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error((body as { detail?: string }).detail || `Request failed (${r.status})`);
  }
  return (await r.json()) as T;
}
