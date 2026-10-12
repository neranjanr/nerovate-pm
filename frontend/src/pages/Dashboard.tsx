import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useAuth } from "../stores/auth";
import { buildDashboardExportUrl, downloadExport } from "../utils/exports";
import { buildStatusSignalMap } from "../utils/statusSignals";

interface StatusInfo {
  id: number;
  name: string;
  color?: string;
  order: number;
  is_done?: boolean;
  stage_id?: number | null;
  kind?: string;
  is_milestone?: boolean;
}

interface WorkloadRow {
  user_id: number;
  username: string;
  name: string;
  open: number;
  overdue: number;
  blocked: number;
  total: number;
}

interface Summary {
  project_id: number;
  total: number;
  by_status: Record<string, number>;
  statuses: StatusInfo[];
  overdue: number;
  due_soon: number;
  blocked: number;
  estimate_mins: number;
  time_spent_mins: number;
  telemetry: {
    tasks_total: number;
    periods_total: number;
    comments_total: number;
    attachments_count: number;
    attachments_bytes: number;
  };
  workload: WorkloadRow[];
}

interface ActivityEvent {
  kind: string;
  task_id: number;
  from_status_id?: number | null;
  to_status_id?: number;
  actor_id?: number | null;
  author_id?: number;
  comment_id?: number;
  body_md?: string;
  at: string;
}

interface BlockedEntry {
  task_id: number;
  title: string;
  blocked_by: number[];
}

interface StorageInfo {
  db_bytes: number;
  uploads_bytes: number;
  uploads_count: number;
  backup_note: string;
}

function fmtBytes(n: number): string {
  if (!n) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let v = n;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v.toFixed(v >= 10 ? 0 : 1)} ${units[u]}`;
}

/**
 * Metrics Dashboard + Workload (SPEC-v0.2 P4, sample page 4).
 * Binds: GET /dashboard/summary, /dashboard/activity, /dashboard/storage,
 * GET /tasks/blocked-map. Workload capacity rows render only for
 * admin/manager roles (view matrix); member sees KPIs without capacity.
 */
export default function Dashboard() {
  const auth = useAuth();
  const { id } = useParams();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [blockedMap, setBlockedMap] = useState<BlockedEntry[]>([]);
  const [taskTitles, setTaskTitles] = useState<Record<number, string>>({});
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [exportError, setExportError] = useState("");

  const canSeeWorkload = auth.role === "admin" || auth.role === "manager";

  const fetchData = useCallback(() => {
    if (!auth.accessToken || !id) return;
    setLoading(true);
    setError("");
    const h = { Authorization: `Bearer ${auth.accessToken}` };
    Promise.all([
      fetch(`/api/v1/dashboard/summary?project_id=${id}`, { headers: h }).then((r) => {
        if (!r.ok) throw new Error(`summary ${r.status}`);
        return r.json();
      }),
      fetch(`/api/v1/dashboard/activity?project_id=${id}&limit=30`, { headers: h }).then((r) =>
        r.ok ? r.json() : []
      ),
      fetch(`/api/v1/tasks/blocked-map?project_id=${id}`, { headers: h }).then((r) =>
        r.ok ? r.json() : []
      ),
      fetch(`/api/v1/dashboard/storage?project_id=${id}`, { headers: h }).then((r) =>
        r.ok ? r.json() : null
      ),
      fetch(`/api/v1/tasks?project_id=${id}`, { headers: h }).then((r) =>
        r.ok ? r.json() : []
      ),
    ])
      .then(([sum, act, blocked, stor, tasks]) => {
        setSummary(sum);
        setActivity(act);
        setBlockedMap(blocked);
        setStorage(stor);
        const titles: Record<number, string> = {};
        for (const t of tasks as { id: number; title: string }[]) titles[t.id] = t.title;
        setTaskTitles(titles);
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message || "Failed to load dashboard");
        setLoading(false);
      });
  }, [auth.accessToken, id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const rootBlocker = useMemo(() => {
    const impact = new Map<number, number>();
    for (const entry of blockedMap) {
      for (const blocker of entry.blocked_by) {
        impact.set(blocker, (impact.get(blocker) || 0) + 1);
      }
    }
    let best: { task_id: number; impacted: number } | null = null;
    for (const [task_id, impacted] of impact) {
      if (!best || impacted > best.impacted) best = { task_id, impacted };
    }
    if (!best) return null;
    const title =
      blockedMap.find((b) => b.task_id === best.task_id)?.title ||
      taskTitles[best.task_id] ||
      `Task #${best.task_id}`;
    return { ...best, title };
  }, [blockedMap, taskTitles]);

  const pipeline = useMemo(() => {
    if (!summary) return [];
    const signalById = buildStatusSignalMap(summary.statuses);
    return [...summary.statuses]
      .sort((a, b) => a.order - b.order)
      .map((s) => ({
        ...s,
        count: summary.by_status[String(s.id)] || 0,
        signal: signalById.get(s.id) ?? { glyph: "", weight: 0, label: "", milestone: false },
      }));
  }, [summary]);

  const exportServer = async (format: "json" | "csv") => {
    if (!auth.accessToken || !id) return;
    setExportError("");
    try {
      await downloadExport(
        buildDashboardExportUrl(id, format),
        auth.accessToken,
        format === "json" ? `dashboard_project_${id}.json` : `workload_project_${id}.csv`
      );
    } catch (e) {
      setExportError(e instanceof Error ? e.message : "Export failed");
    }
  };

  if (loading && !summary) return <div role="status" className="p-6 text-on-surface-variant text-sm">Loading dashboard…</div>;

  return (
    <main className="flex-1 bg-surface text-on-surface p-6 space-y-6 overflow-y-auto">
      {error && <div role="alert" className="p-3 bg-error-container text-error text-xs rounded">{error}</div>}
      {exportError && <div role="alert" className="p-3 bg-error-container text-error text-xs rounded">{exportError}</div>}

      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Metrics Dashboard &amp; Workload</h1>
        <div className="flex gap-2">
          <button
            onClick={fetchData}
            className="px-3 py-1.5 bg-surface-container hover:bg-surface-container-high rounded border border-subtle text-xs font-medium"
          >
            Refresh
          </button>
          <button
            onClick={() => void exportServer("json")}
            className="px-3 py-1.5 bg-primary-container hover:bg-primary rounded text-xs font-medium text-on-primary"
          >
            Export JSON
          </button>
          {canSeeWorkload && (
            <button
              onClick={() => void exportServer("csv")}
              className="px-3 py-1.5 bg-surface-container hover:bg-surface-container-high rounded border border-subtle text-xs font-medium"
            >
              Export CSV
            </button>
          )}
          <button
            onClick={() => window.print()}
            className="px-3 py-1.5 bg-surface-container hover:bg-surface-container-high rounded border border-subtle text-xs font-medium"
          >
            Export PDF
          </button>
        </div>
      </div>
      {loading && summary && <div role="status" className="text-xs text-outline">Refreshing…</div>}

      {/* KPI SUMMARY CARDS: 5 Columns Grid (GET /api/v1/dashboard/summary) */}
      <section className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: "Total tasks", value: summary?.total ?? 0 },
          { label: "Overdue", value: summary?.overdue ?? 0 },
          { label: "Due soon (7d)", value: summary?.due_soon ?? 0 },
          { label: "Blocked", value: summary?.blocked ?? 0 },
          { label: "Comments", value: summary?.telemetry.comments_total ?? 0 },
        ].map((kpi) => (
          <div key={kpi.label} className="bg-surface-container-lowest border border-subtle rounded-lg p-4">
            <div className="text-2xl font-bold">{kpi.value}</div>
            <div className="text-xs text-on-surface-variant mt-1">{kpi.label}</div>
          </div>
        ))}
      </section>
      {summary && (
        <div className="text-[11px] text-outline font-mono">
          Telemetry: {summary.telemetry.periods_total} status periods ·{" "}
          {summary.telemetry.attachments_count} attachments ({fmtBytes(summary.telemetry.attachments_bytes)}) ·
          est {summary.estimate_mins}m vs spent {summary.time_spent_mins}m
        </div>
      )}

      {/* Status pipeline flow with counts + mini target-vs-actual bars */}
      <section className="bg-surface-container-lowest border border-subtle rounded-lg p-4">
        <h2 className="text-sm font-semibold mb-3">Status pipeline</h2>
        <div className="flex items-center gap-2 overflow-x-auto">
          {pipeline.map((s, idx) => (
            <div key={s.id} className="flex items-center gap-2 shrink-0">
              <div
                className="px-3 py-1.5 rounded bg-surface-container border border-subtle text-xs flex items-center gap-2"
                title={s.signal.glyph ? `Weight ${s.signal.weight}% within stage · ${s.signal.label}` : undefined}
              >
                {s.signal.glyph && (
                  <span
                    role="img"
                    aria-label={`Status signal: ${s.signal.glyph} ${s.signal.weight}% ${s.signal.label}`}
                    className="font-mono text-on-surface-variant"
                  >
                    {s.signal.glyph} {s.signal.weight}%
                  </span>
                )}
                <span className="font-medium">{s.name}</span>
                <span className="px-1.5 rounded bg-surface-container-lowest text-on-surface-variant font-mono">{s.count}</span>
              </div>
              {idx < pipeline.length - 1 && <span className="text-outline">→</span>}
            </div>
          ))}
          {pipeline.length === 0 && <span className="text-xs text-outline">No statuses yet.</span>}
        </div>
        {summary && summary.total > 0 && (
          <div className="mt-3 space-y-1.5">
            {pipeline.map((s) => {
              const pct = Math.round((s.count / summary.total) * 100);
              return (
                <div key={s.id} className="flex items-center gap-2 text-[11px]">
                  <span className="w-32 truncate text-on-surface-variant">{s.name}</span>
                  <div className="flex-1 h-2 bg-surface-container rounded overflow-hidden">
                    <div className="h-full bg-indigo-500" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="w-10 text-right font-mono text-on-surface-variant">{pct}%</span>
                </div>
              );
            })}
            <div className="flex items-center gap-2 text-[11px] pt-1">
              <span className="w-32 truncate text-on-surface-variant">Target vs actual (time)</span>
              <div
                className="flex-1 h-2 bg-surface-container rounded overflow-hidden"
                title={`Estimated ${summary.estimate_mins}m vs spent ${summary.time_spent_mins}m`}
              >
                <div
                  className="h-full bg-emerald-500"
                  style={{
                    width: `${
                      summary.estimate_mins > 0
                        ? Math.min(100, Math.round((summary.time_spent_mins / summary.estimate_mins) * 100))
                        : summary.time_spent_mins > 0
                          ? 100
                          : 0
                    }%`,
                  }}
                />
              </div>
              <span className="w-24 text-right font-mono text-on-surface-variant">
                {summary.time_spent_mins}m / {summary.estimate_mins}m
              </span>
            </div>
          </div>
        )}
      </section>

      {/* Dependency preview (root blocker → impacted) */}
      <section className="bg-surface-container-lowest border border-subtle rounded-lg p-4">
        <h2 className="text-sm font-semibold mb-2">Dependency preview</h2>
        {rootBlocker ? (
          <div className="text-xs text-on-surface-variant">
            Root blocker <strong className="text-on-primary">#{rootBlocker.task_id} {rootBlocker.title}</strong>
            {" "}→ impacts <strong className="text-error">{rootBlocker.impacted}</strong> task(s).
            <span className="text-outline"> ({summary?.blocked ?? 0} blocked total)</span>
          </div>
        ) : (
          <div className="text-xs text-outline">No blocked dependencies — critical path is clear.</div>
        )}
      </section>

      {/* Team Capacity Rows (workload-gated: hidden from member/guest) */}
      {canSeeWorkload ? (
        <section className="bg-surface-container-lowest border border-subtle rounded-lg p-4">
          <h2 className="text-sm font-semibold mb-3">Team capacity</h2>
          {(summary?.workload || []).length === 0 && (
            <div className="text-xs text-outline">No assignees yet.</div>
          )}
          <div className="space-y-2">
            {(summary?.workload || []).map((w) => {
              const cap = Math.min(100, Math.round((w.open / Math.max(1, w.total)) * 100));
              return (
                <div key={w.user_id} className="flex items-center gap-3 text-xs">
                  <span className="w-36 truncate font-medium">{w.name}</span>
                  <div className="flex-1 h-2.5 bg-surface-container rounded overflow-hidden">
                    <div
                      className={`h-full ${w.overdue > 0 ? "bg-rose-500" : "bg-emerald-500"}`}
                      style={{ width: `${cap}%` }}
                    />
                  </div>
                  <span className="font-mono text-on-surface-variant w-48 text-right">
                    {w.open} open · {w.overdue} overdue · {w.blocked} blocked
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      <div className="grid md:grid-cols-2 gap-4">
        {/* AUDIT & EVENT DISPATCH STREAM */}
        <section className="bg-surface-container-lowest border border-subtle rounded-lg p-4">
          <h2 className="text-sm font-semibold mb-3">Audit &amp; event stream</h2>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {activity.map((e, i) => (
              <div key={`${e.kind}-${i}`} className="text-xs bg-surface-container/60 border border-subtle rounded p-2">
                <span className="font-mono text-primary">{e.kind}</span>
                <span className="text-on-surface-variant"> · task #{e.task_id} · </span>
                <span className="text-outline font-mono">{e.at}</span>
                {e.kind === "task.comment_added" && e.body_md && (
                  <div className="text-on-surface-variant mt-1 truncate">{e.body_md}</div>
                )}
              </div>
            ))}
            {activity.length === 0 && <div className="text-xs text-outline">No events yet.</div>}
          </div>
        </section>

        {/* On-Prem Storage & Backup Card */}
        <section className="bg-surface-container-lowest border border-subtle rounded-lg p-4">
          <h2 className="text-sm font-semibold mb-3">On-prem storage &amp; backup</h2>
          {storage ? (
            <div className="text-xs space-y-1.5 text-on-surface-variant">
              <div>
                Database: <strong className="font-mono">{fmtBytes(storage.db_bytes)}</strong> (SQLite WAL)
              </div>
              <div>
                Uploads: <strong className="font-mono">{fmtBytes(storage.uploads_bytes)}</strong> ·{" "}
                {storage.uploads_count} file(s)
              </div>
              <div className="text-outline">{storage.backup_note}</div>
            </div>
          ) : (
            <div className="text-xs text-outline">Storage info unavailable.</div>
          )}
        </section>
      </div>
    </main>
  );
}
