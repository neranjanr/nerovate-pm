/** Slice 4 seam: board card code + dated status-move body (pure, testable). */

export function formatTaskCode(task: { id: number; wbs?: string | null }): string {
  const wbs = (task.wbs ?? "").trim();
  return wbs ? wbs : `#${task.id}`;
}

export function boardStatusMoveBody(
  statusId: number,
  today: string
): { status_id: number; start_date: string } {
  return { status_id: statusId, start_date: today };
}

/** ADR-0010: dropping onto an empty-Stage column assigns the Stage directly
 * (no Status Period dates — periods are leaf-only). */
export function boardStageMoveBody(stageId: number): { stage_id: number } {
  return { stage_id: stageId };
}

/**
 * ADR-0010 issue 02 seam: resolve a Standard-view Stage-column drop.
 *
 * - Explicit leaf (bucket tile / chip / `leafId`) always wins, even filtered.
 * - Empty Stage resolves to a direct Stage assignment (single destination).
 * - Filtered/partial views never auto-resolve a non-empty Stage: the caller
 *   must block with a "clear filters" error instead of remapping.
 * - Single-leaf unfiltered drops are deterministic (the only destination).
 * - Multi-leaf unfiltered drops force a Status picker preselected on the
 *   first leaf — never a silent first-Status move.
 */
export type StageDropResolution =
  | { kind: "direct-stage" }
  | { kind: "explicit-move"; statusId: number }
  | { kind: "force-picker"; choices: number[] }
  | { kind: "blocked-filtered" };

export function resolveStageDrop(args: {
  leafIds: number[];
  leafId?: number | null;
  filtersActive: boolean;
}): StageDropResolution {
  const { leafIds, leafId, filtersActive } = args;
  if (leafId != null) return { kind: "explicit-move", statusId: leafId };
  if (leafIds.length === 0) return { kind: "direct-stage" };
  if (filtersActive) return { kind: "blocked-filtered" };
  if (leafIds.length === 1) return { kind: "explicit-move", statusId: leafIds[0] };
  return { kind: "force-picker", choices: [...leafIds] };
}
