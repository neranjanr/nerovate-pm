import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useAuth } from "../stores/auth";
import TaskDrawer from "../components/TaskDrawer";
import TelemetryBar from "../components/TelemetryBar";
import {
  GRANULARITIES,
  buildTimelineExportUrl,
  downloadExport,
  filterByDepth,
  ganttMinWidth,
  pxPerDay,
  type Granularity,
} from "../utils/exports";

interface StatusPeriod {
  id: number;
  task_id: number;
  status_id: number;
  start_date?: string | null;
  due_date?: string | null;
  actual_end_date?: string | null;
  actor_id?: number | null;
  created_at: string;
}

interface TimelineItem {
  task_id: number;
  title: string;
  depth: number;
  parent_id?: number | null;
  status_id: number;
  status_name: string;
  start_date: string;
  due_date?: string | null;
  assignee_ids: number[];
  is_blocked: boolean;
  periods: StatusPeriod[];
}

interface ProjectStatus {
  id: number;
  name: string;
  color?: string;
  order: number;
  is_done?: boolean;
  is_blocked?: boolean;
}

interface ProjectMemberInfo {
  user_id: number;
  role: string;
}

const TODAY = () => new Date().toISOString().slice(0, 10);

export default function Timeline() {
  const auth = useAuth();
  const { id } = useParams();
  const [tasks, setTasks] = useState<TimelineItem[]>([]);
  const [statuses, setStatuses] = useState<ProjectStatus[]>([]);
  const [, setMembers] = useState<ProjectMemberInfo[]>([]);
  const [selectedTask, setSelectedTask] = useState<TimelineItem | null>(null);
  const [drawerTaskId, setDrawerTaskId] = useState<number | null>(null);
  const [depthFilter, setDepthFilter] = useState<string>("all");
  const [granularity, setGranularity] = useState<Granularity>("week");
  const [showPeriods, setShowPeriods] = useState<boolean>(true);
  const [blockedOnly, setBlockedOnly] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [exportError, setExportError] = useState<string>("");
  const ganttRef = useRef<HTMLDivElement>(null);
  const todayRef = useRef<HTMLDivElement>(null);

  const fetchData = () => {
    if (!auth.accessToken || !id) return;
    setLoading(true);
    setError("");
    Promise.all([
      fetch(`/api/v1/tasks/timeline?project_id=${id}`, {
        headers: { Authorization: `Bearer ${auth.accessToken}` },
      }).then((r) => {
        if (!r.ok) throw new Error(`Timeline failed: ${r.status}`);
        return r.json();
      }),
      fetch(`/api/v1/projects/${id}`, {
        headers: { Authorization: `Bearer ${auth.accessToken}` },
      }).then((r) => (r.ok ? r.json() : null)),
      fetch(`/api/v1/projects/${id}/members`, {
        headers: { Authorization: `Bearer ${auth.accessToken}` },
      }).then((r) => (r.ok ? r.json() : [])),
    ])
      .then(async ([timelineTasks, projData, mems]) => {
        setTasks(timelineTasks);
        setMembers(mems);
        if (projData && projData.status_profile_id) {
          const stRes = await fetch(`/api/v1/status-profiles/${projData.status_profile_id}`, {
            headers: { Authorization: `Bearer ${auth.accessToken}` },
          });
          if (stRes.ok) {
            const stData = await stRes.json();
            setStatuses(stData.statuses || []);
          }
        }
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message || "Failed to load timeline");
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchData();
  }, [auth.accessToken, id]);

  const filteredTasks = useMemo(() => {
    let rows = filterByDepth(tasks, depthFilter);
    if (blockedOnly) rows = rows.filter((t) => t.is_blocked);
    return rows;
  }, [tasks, depthFilter, blockedOnly]);

  const today = TODAY();
  const todayDueCount = useMemo(
    () => tasks.filter((t) => (t.due_date || "").slice(0, 10) === today).length,
    [tasks, today]
  );

  const jumpToday = () => {
    todayRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const exportServer = async (format: "json" | "csv") => {
    if (!auth.accessToken || !id) return;
    setExportError("");
    try {
      await downloadExport(
        buildTimelineExportUrl(id, format, depthFilter),
        auth.accessToken,
        `timeline_project_${id}${depthFilter !== "all" ? `_depth${depthFilter}` : ""}.${format}`
      );
    } catch (e) {
      setExportError(e instanceof Error ? e.message : "Export failed");
    }
  };

  const getWbsNumber = (index: number, taskList: TimelineItem[]): string => {
    const task = taskList[index];
    if (!task) return `${index + 1}`;
    if (task.depth === 0) {
      let count = 0;
      for (let i = 0; i <= index; i++) {
        if (taskList[i].depth === 0) count++;
      }
      return `${count}`;
    }
    if (task.depth === 1) {
      const parent = taskList.slice(0, index).reverse().find((t) => t.depth === 0);
      const parentIdx = parent ? taskList.indexOf(parent) : 0;
      const parentWbs: string = getWbsNumber(parentIdx, taskList);
      let subCount = 0;
      for (let i = 0; i <= index; i++) {
        if (taskList[i].depth === 1 && taskList[i].parent_id === task.parent_id) {
          subCount++;
        }
      }
      return `${parentWbs}.${subCount}`;
    }
    if (task.depth === 2) {
      const parent = taskList.slice(0, index).reverse().find((t) => t.depth === 1);
      const parentIdx = parent ? taskList.indexOf(parent) : 0;
      const parentWbs: string = parent ? getWbsNumber(parentIdx, taskList) : "1.1";
      let microCount = 0;
      for (let i = 0; i <= index; i++) {
        if (taskList[i].depth === 2 && taskList[i].parent_id === task.parent_id) {
          microCount++;
        }
      }
      return `${parentWbs}.${microCount}`;
    }
    return `${index + 1}`;
  };

  const totalTasks = tasks.length;
  const completedTasks = tasks.filter((t) => {
    const st = statuses.find((s) => s.id === t.status_id);
    return st?.is_done;
  }).length;
  const blockedTasks = tasks.filter((t) => t.is_blocked).length;

  return (
    <main className="flex-1 bg-slate-950 text-slate-100 flex flex-col h-[calc(100vh-110px)] overflow-hidden">
      {error && (
        <div role="alert" className="p-3 bg-rose-950 text-rose-300 text-xs">
          {error}
        </div>
      )}
      {loading && (
        <div role="status" className="p-3 text-slate-400 text-xs">
          Loading timeline...
        </div>
      )}
      {/* Status Profile progress */}
      <div className="bg-slate-900 border-b border-slate-800 px-6 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 overflow-x-auto">
          <span className="text-xs uppercase tracking-wider text-slate-400 font-semibold shrink-0">Status flow:</span>
          {statuses.map((st, idx) => {
            const count = tasks.filter((t) => t.status_id === st.id).length;
            return (
              <div key={st.id} className="flex items-center gap-2 shrink-0">
                <div className="px-3 py-1 rounded bg-slate-800 border border-slate-700 text-xs flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-indigo-400"></span>
                  <span className="font-medium text-slate-200">{st.name}</span>
                  <span className="px-1.5 py-0.2 bg-slate-900 rounded text-slate-400 text-[10px] font-mono">{count}</span>
                </div>
                {idx < statuses.length - 1 && <span className="text-slate-600">→</span>}
              </div>
            );
          })}
          {statuses.length === 0 && !loading && (
            <span className="text-xs text-slate-500">No statuses yet.</span>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs shrink-0">
          <div className="px-2.5 py-1 rounded bg-slate-800 text-slate-300">
            Total: <strong className="text-white">{totalTasks}</strong>
          </div>
          <div className="px-2.5 py-1 rounded bg-emerald-950/80 text-emerald-300 border border-emerald-900">
            Completed: <strong className="text-white">{completedTasks}</strong>
          </div>
          <div className="px-2.5 py-1 rounded bg-rose-950/80 text-rose-300 border border-rose-900">
            Blocked: <strong className="text-white">{blockedTasks}</strong>
          </div>
        </div>
      </div>

      {/* Controls Bar */}
      <div className="bg-slate-900/50 border-b border-slate-800 px-6 py-2 flex items-center justify-between gap-4 text-xs flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5 bg-slate-800 rounded p-1 border border-slate-700">
            <span className="px-2 text-slate-400">Depth:</span>
            {["all", "0", "1", "2"].map((d) => (
              <button
                key={d}
                onClick={() => setDepthFilter(d)}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                  depthFilter === d ? "bg-indigo-600 text-white" : "text-slate-300 hover:text-white"
                }`}
              >
                {d === "all" ? "All" : `Depth ${d}`}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5 bg-slate-800 rounded p-1 border border-slate-700">
            <span className="px-2 text-slate-400">Granularity:</span>
            {GRANULARITIES.map((g) => (
              <button
                key={g}
                onClick={() => setGranularity(g)}
                className={`px-2.5 py-1 rounded text-xs font-medium capitalize transition-colors ${
                  granularity === g ? "bg-indigo-600 text-white" : "text-slate-300 hover:text-white"
                }`}
              >
                {g}
              </button>
            ))}
          </div>
          <button
            onClick={() => setShowPeriods((v) => !v)}
            className={`px-2.5 py-1.5 rounded border text-xs font-medium transition-colors ${
              showPeriods
                ? "bg-slate-800 border-indigo-500 text-indigo-200"
                : "bg-slate-800 border-slate-700 text-slate-400"
            }`}
            title="Toggle per-Status period segments"
          >
            Periods: {showPeriods ? "on" : "off"}
          </button>
          <button
            onClick={() => setBlockedOnly((v) => !v)}
            className={`px-2.5 py-1.5 rounded border text-xs font-medium transition-colors ${
              blockedOnly
                ? "bg-rose-950 border-rose-700 text-rose-200"
                : "bg-slate-800 border-slate-700 text-slate-400"
            }`}
          >
            Blocked only: {blockedOnly ? "on" : "off"}
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={jumpToday}
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded border border-slate-700 font-medium transition-colors"
            title={todayDueCount > 0 ? `${todayDueCount} task(s) due today` : "Scroll to the Today marker"}
          >
            Jump Today
          </button>
          <button
            onClick={() => void exportServer("json")}
            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded font-medium transition-colors"
          >
            Export JSON
          </button>
          <button
            onClick={() => void exportServer("csv")}
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded border border-slate-700 font-medium transition-colors"
          >
            Export CSV
          </button>
          <button
            onClick={() => window.print()}
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded border border-slate-700 font-medium transition-colors"
          >
            Export PDF
          </button>
        </div>
      </div>
      {exportError && (
        <div role="alert" className="px-6 py-1.5 bg-rose-950 text-rose-300 text-xs">
          {exportError}
        </div>
      )}

      {/* Split Workspace: Left WBS Table & Right Gantt Chart */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left PANE: WBS & RACI INSPECTOR TABLE (~45%) */}
        <div className="w-1/2 border-r border-slate-800 flex flex-col bg-slate-900/30 overflow-y-auto">
          <div className="grid grid-cols-12 bg-slate-900 border-b border-slate-800 px-4 py-2.5 text-xs font-semibold text-slate-400 sticky top-0 z-10">
            <div className="col-span-2">WBS</div>
            <div className="col-span-5">Task Name</div>
            <div className="col-span-3">Status</div>
            <div className="col-span-2 text-right">Due Date</div>
          </div>
          <div className="divide-y divide-slate-800/60">
            {filteredTasks.map((t, index) => {
              const wbsCode = getWbsNumber(index, filteredTasks);
              const indentClass = t.depth === 1 ? "pl-4" : t.depth === 2 ? "pl-8" : "pl-0";
              const isSelected = selectedTask?.task_id === t.task_id;
              return (
                <div
                  key={t.task_id}
                  onClick={() => setSelectedTask(t)}
                  className={`grid grid-cols-12 px-4 py-3 text-xs items-center cursor-pointer transition-colors ${
                    isSelected ? "bg-indigo-950/40 border-l-2 border-indigo-500" : "hover:bg-slate-900/60"
                  }`}
                >
                  <div className="col-span-2 font-mono text-slate-400 font-semibold">{wbsCode}</div>
                  <div className={`col-span-5 font-medium text-slate-200 truncate ${indentClass}`}>
                    {t.is_blocked && <span className="text-rose-400 mr-1" title="Blocked">⚠️</span>}
                    {t.title}
                  </div>
                  <div className="col-span-3">
                    <span className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-300 text-[11px]">
                      {t.status_name || "Status"}
                    </span>
                  </div>
                  <div className="col-span-2 text-right font-mono text-slate-400 text-[11px]">
                    {t.due_date || "No due date"}
                  </div>
                </div>
              );
            })}
            {filteredTasks.length === 0 && !loading && (
              <div className="py-12 text-center text-slate-500 text-sm">No tasks found for the current depth filter.</div>
            )}
          </div>
        </div>

        {/* Right PANE: Timeline Gantt & Status Period Segments (~55%) */}
        <div ref={ganttRef} className="w-1/2 flex flex-col bg-slate-950 overflow-x-auto overflow-y-auto">
          <div className="bg-slate-900 border-b border-slate-800 px-4 py-2.5 text-xs font-semibold text-slate-400 sticky top-0 z-10 flex items-center justify-between">
            <span>Execution Timeline Gantt ({granularity.toUpperCase()} · {pxPerDay(granularity)}px/day)</span>
            <div className="flex items-center gap-3 text-[11px] text-slate-400">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-indigo-500"></span> Planned/Active</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-emerald-500"></span> Done</span>
            </div>
          </div>
          <div ref={todayRef} className="mx-4 mt-3 px-3 py-1.5 rounded border border-amber-700/60 bg-amber-950/40 text-[11px] text-amber-200 font-mono scroll-mt-4">
            Today: {today}{todayDueCount > 0 ? ` — ${todayDueCount} task(s) due` : " — nothing due"}
          </div>
          <div className="p-4 space-y-4" style={{ minWidth: ganttMinWidth(granularity) }}>
            {filteredTasks.map((t, index) => {
              const wbsCode = getWbsNumber(index, filteredTasks);
              const isSelected = selectedTask?.task_id === t.task_id;
              const isTodayDue = (t.due_date || "").slice(0, 10) === today;
              return (
                <div
                  key={t.task_id}
                  onClick={() => setSelectedTask(t)}
                  className={`p-3 rounded-lg border transition-all cursor-pointer ${
                    isSelected ? "bg-indigo-950/20 border-indigo-500/50" : "bg-slate-900/40 border-slate-800 hover:border-slate-700"
                  } ${isTodayDue ? "ring-1 ring-amber-500/60" : ""}`}
                >
                  <div className="flex items-center justify-between text-xs mb-2">
                    <span className="font-mono text-slate-400 font-semibold">{wbsCode} — <strong className="text-slate-200">{t.title}</strong></span>
                    <span className="text-slate-400 font-mono text-[11px]">Start: {t.start_date}</span>
                  </div>
                  {/* Status periods visual bar */}
                  <div className="relative h-6 bg-slate-900 rounded border border-slate-800 flex items-center overflow-hidden px-2">
                    {showPeriods && t.periods && t.periods.length > 0 ? (
                      <div className="flex items-center gap-1 w-full">
                        {t.periods.map((p) => {
                          const stObj = statuses.find((s) => s.id === p.status_id);
                          const isDone = stObj?.is_done;
                          return (
                            <div
                              key={p.id}
                              title={`Status: ${stObj?.name || p.status_id} (${p.start_date || "?"} → ${p.due_date || "?"})`}
                              className={`h-4 rounded flex items-center justify-center text-[10px] font-mono px-2 text-white truncate ${
                                isDone ? "bg-emerald-600" : "bg-indigo-600"
                              }`}
                              style={{ flex: 1 }}
                            >
                              {granularity === "day" || granularity === "week" ? stObj?.name || "Period" : ""}
                            </div>
                          );
                        })}
                      </div>
                    ) : showPeriods ? (
                      <div className="text-[11px] text-slate-500 italic">No per-status periods recorded yet</div>
                    ) : (
                      <div
                        className="h-4 rounded bg-indigo-600"
                        style={{ width: "100%" }}
                        title={`${t.start_date} → ${t.due_date || "no due"}`}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Telemetry + backup strip */}
      <div className="bg-slate-900/60 border-t border-slate-800 px-6 py-1.5">
        {id && <TelemetryBar projectId={id} />}
      </div>

      {/* Bottom Inspector Drawer / Card */}
      {selectedTask && (
        <div className="bg-slate-900 border-t border-slate-800 p-4 shadow-xl">
          <div className="max-w-7xl mx-auto flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="font-mono text-xs px-2 py-0.5 rounded bg-indigo-950 text-indigo-300 font-semibold">
                  Task #{selectedTask.task_id} (Depth {selectedTask.depth})
                </span>
                <span className="text-xs text-slate-400">Current Status: <strong className="text-white">{selectedTask.status_name}</strong></span>
              </div>
              <h3 className="text-base font-semibold text-slate-100">{selectedTask.title}</h3>
              <p className="text-xs text-slate-400 mt-1">
                Start: <span className="text-slate-200 font-mono">{selectedTask.start_date}</span> | Due: <span className="text-slate-200 font-mono">{selectedTask.due_date || "None"}</span>
              </p>
            </div>
            <div className="flex items-start gap-4">
              <div>
                <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Status Periods Log ({selectedTask.periods.length})</h4>
                <div className="flex gap-2 overflow-x-auto max-w-md">
                  {selectedTask.periods.map((p) => {
                    const st = statuses.find((s) => s.id === p.status_id);
                    return (
                      <div key={p.id} className="bg-slate-800 border border-slate-700 rounded p-2 text-[11px] shrink-0">
                        <div className="font-semibold text-indigo-300">{st?.name || `Status #${p.status_id}`}</div>
                        <div className="text-slate-400 font-mono text-[10px]">Start: {p.start_date || "—"}</div>
                        <div className="text-slate-400 font-mono text-[10px]">Due: {p.due_date || "—"}</div>
                        {p.actual_end_date && <div className="text-emerald-400 font-mono text-[10px]">End: {p.actual_end_date}</div>}
                      </div>
                    );
                  })}
                  {selectedTask.periods.length === 0 && (
                    <div className="text-[11px] text-slate-500 italic">No periods yet.</div>
                  )}
                </div>
              </div>
              <button
                onClick={() => setDrawerTaskId(selectedTask.task_id)}
                className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 rounded text-xs font-semibold text-white mr-2"
              >
                Open Task Drawer
              </button>
              <button
                onClick={() => setSelectedTask(null)}
                className="text-slate-400 hover:text-white text-lg font-bold px-2 py-1"
                title="Close Inspector"
              >
                ✕
              </button>
            </div>
          </div>
        </div>
      )}
      {drawerTaskId && (
        <TaskDrawer
          taskId={drawerTaskId}
          projectId={id!}
          onClose={() => setDrawerTaskId(null)}
          onUpdated={fetchData}
        />
      )}
    </main>
  );
}
