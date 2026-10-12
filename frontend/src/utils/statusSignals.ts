/**
 * Status Weight / Glyph / Kind derivation seam (status-glyph-weight spec).
 * Pure mirror of backend/app/statuses/signals.py: one function of
 * (index, sibling count, kind, is_done) producing (glyph, percent).
 * Derived from ordering, never stored: reorder and recascade always agree.
 */

export const STATUS_KINDS = ["normal", "on_hold", "blocked", "attention", "cancelled"] as const;
export type StatusKind = (typeof STATUS_KINDS)[number];

export const NORMAL_RAMP = ["○", "◔", "◑", "◕", "●"] as const;

export const KIND_GLYPHS: Record<Exclude<StatusKind, "normal">, string> = {
  on_hold: "‖",
  blocked: "!",
  attention: "!!",
  cancelled: "×",
};

export const DONE_GLYPH = "✓";
export const MILESTONE_BADGE = "★";

export const KIND_LABELS: Record<StatusKind | "done", string> = {
  normal: "progress",
  on_hold: "on hold",
  blocked: "blocked",
  attention: "attention required",
  cancelled: "cancelled",
  done: "done",
};

export function normalizeKind(value: string | null | undefined): StatusKind {
  const kind = (value ?? "normal").trim().toLowerCase();
  if ((STATUS_KINDS as readonly string[]).includes(kind)) return kind as StatusKind;
  throw new Error(`Unknown status kind: ${value}`);
}

/** Display-only percent of position i within its own Stage. */
export function statusWeight(index: number, total: number): number {
  if (total <= 1) return 100;
  const idx = Math.max(0, Math.min(index, total - 1));
  return Math.round((idx / (total - 1)) * 100);
}

/** Single text glyph: Done wins, then kind override, then position ramp. */
export function statusGlyph(
  index: number,
  total: number,
  kind: string = "normal",
  isDone = false
): string {
  if (isDone) return DONE_GLYPH;
  const k = normalizeKind(kind);
  if (k !== "normal") return KIND_GLYPHS[k];
  if (total <= 1) return NORMAL_RAMP[NORMAL_RAMP.length - 1];
  const idx = Math.max(0, Math.min(index, total - 1));
  const fraction = idx / (total - 1);
  const bucket = Math.min(NORMAL_RAMP.length - 1, Math.floor(fraction * NORMAL_RAMP.length));
  return NORMAL_RAMP[bucket];
}

export interface StatusSignal {
  glyph: string;
  weight: number;
}

/** Shared seam: (glyph, percent) from ordering + flags. */
export function deriveStatusSignal(
  index: number,
  total: number,
  kind = "normal",
  isDone = false
): StatusSignal {
  return { glyph: statusGlyph(index, total, kind, isDone), weight: statusWeight(index, total) };
}

/** Assistive-tech label for a glyph; color is never the sole signal. */
export function kindLabel(kind = "normal", isDone = false): string {
  if (isDone) return KIND_LABELS.done;
  return KIND_LABELS[normalizeKind(kind)];
}

/** Mean positional weight across a Stage's tasks, rounded; 0 when empty. */
export function stageAverage(weights: number[]): number {
  if (weights.length === 0) return 0;
  return Math.round(weights.reduce((a, b) => a + b, 0) / weights.length);
}

export interface SignalInput {
  id: number;
  order?: number;
  stage_id?: number | null;
  kind?: string;
  is_done?: boolean;
  is_milestone?: boolean;
}

export interface StatusSignalInfo {
  glyph: string;
  weight: number;
  label: string;
  milestone: boolean;
}

/** Per-Status signals keyed by status id, derived from within-Stage ordering. */
export function buildStatusSignalMap(statuses: SignalInput[]): Map<number, StatusSignalInfo> {
  const map = new Map<number, StatusSignalInfo>();
  const byStage = new Map<number | null, SignalInput[]>();
  for (const s of statuses) {
    const k = s.stage_id ?? null;
    if (!byStage.has(k)) byStage.set(k, []);
    byStage.get(k)!.push(s);
  }
  for (const group of byStage.values()) {
    const ordered = [...group].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    ordered.forEach((s, i) => {
      const sig = deriveStatusSignal(i, ordered.length, s.kind ?? "normal", !!s.is_done);
      map.set(s.id, {
        ...sig,
        label: kindLabel(s.kind ?? "normal", !!s.is_done),
        milestone: !!s.is_milestone,
      });
    });
  }
  return map;
}
