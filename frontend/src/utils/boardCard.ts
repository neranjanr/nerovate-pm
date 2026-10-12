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
