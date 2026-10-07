/** Shared T9 helpers: depth filtering, granularity scaling, export URLs.
 *
 * Timeline and Board import from here so Day/Week/Month/Quarter + depth
 * 0/1/2 + Jump Today behave consistently (SPEC-v0.2 P3 controls).
 */

export type Granularity = "day" | "week" | "month" | "quarter";

export interface DepthFilterable {
  depth: number;
}

export const DEPTH_OPTIONS = ["all", "0", "1", "2"] as const;
export type DepthOption = (typeof DEPTH_OPTIONS)[number];

export const GRANULARITIES: Granularity[] = ["day", "week", "month", "quarter"];

/** px per day used by the Gantt pane; coarser grains compress the scale. */
export function pxPerDay(g: Granularity): number {
  switch (g) {
    case "day":
      return 48;
    case "week":
      return 12;
    case "month":
      return 4;
    case "quarter":
      return 1.5;
  }
}

/** Min row width for the Gantt pane at a given granularity. */
export function ganttMinWidth(g: Granularity): number {
  switch (g) {
    case "day":
      return 720;
    case "week":
      return 600;
    case "month":
      return 480;
    case "quarter":
      return 360;
  }
}

/** Client-side depth filter shared by Timeline WBS and Board columns. */
export function filterByDepth<T extends DepthFilterable>(tasks: T[], depth: string): T[] {
  if (depth === "0" || depth === "1" || depth === "2") {
    const d = Number(depth);
    return tasks.filter((t) => t.depth === d);
  }
  return tasks;
}

export function buildTimelineExportUrl(
  projectId: string,
  format: "json" | "csv",
  depth: string,
  stageId?: string
): string {
  const p = new URLSearchParams({ project_id: projectId, format });
  if (depth === "0" || depth === "1" || depth === "2") p.set("depth", depth);
  if (stageId) p.set("stage_id", stageId);
  return `/api/v1/tasks/timeline/export?${p.toString()}`;
}

export function buildTimelineUrl(projectId: string, depth: string, stageId?: string): string {
  const p = new URLSearchParams({ project_id: projectId });
  if (depth === "0" || depth === "1" || depth === "2") p.set("depth", depth);
  if (stageId) p.set("stage_id", stageId);
  return `/api/v1/tasks/timeline?${p.toString()}`;
}

export function buildDashboardExportUrl(projectId: string, format: "json" | "csv"): string {
  const p = new URLSearchParams({ project_id: projectId, format });
  return `/api/v1/dashboard/export?${p.toString()}`;
}

/** Download a same-origin export URL with the current bearer token. */
export async function downloadExport(
  url: string,
  token: string,
  filename: string
): Promise<void> {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`Export failed: ${r.status}`);
  const blob = await r.blob();
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.setAttribute("href", href);
  a.setAttribute("download", filename);
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(href);
}
