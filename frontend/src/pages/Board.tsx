import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import TaskFilters, { EMPTY_FILTERS, buildTaskQuery, type TaskFilterState } from "../components/TaskFilters";
import TelemetryBar from "../components/TelemetryBar";
import { useAuth } from "../stores/auth";
import { buildTimelineExportUrl, downloadExport } from "../utils/exports";

interface BoardTask {
  id: number;
  title: string;
  status_id: number;
  depth: number;
  parent_id?: number | null;
  priority: string;
  start_date: string;
  due_date?: string | null;
  assignee_ids: number[];
  tag_names: string[];
  blocked_by_ids: number[];
  is_blocked: boolean;
  estimate_mins?: number | null;
  time_spent_mins: number;
}

interface StatusInfo {
  id: number;
  name: string;
  order: number;
  is_done?: boolean;
}

const TODAY = () => new Date().toISOString().slice(0, 10);

/**
 * Kanban Board + Task Hierarchy (SPEC-v0.2 P2, sample page 3).
 * Columns = Statuses of the Project Profile. Drag-drop changes Status via
 * POST /tasks/{id}/status (upserts Status Period + history). Depth 0/1/2
 * filter semantics match Timeline (shared TaskFilters + segmented control).
 */
export default function Board() {
  const auth = useAuth();
  const { id } = useParams();
  const [tasks, setTasks] = useState<BoardTask[]>([]);
  const [statuses, setStatuses] = useState<StatusInfo[]>([]);
  const [filters, setFilters] = useState<TaskFilterState>({ ...EMPTY_FILTERS });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [exportError, setExportError] = useState("");
  const [dragId, setDragId] = useState<number | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const todayTaskRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  const fetchTasks = useCallback(() => {
    if (!auth.accessToken || !id) return;
    setLoading(true);
    setError("");
    const q = buildTaskQuery(id, filters);
    fetch(`/api/v1/tasks?${q}`, { headers: { Authorization: `Bearer ${auth.accessToken}` } })
      .then((r) => {
        if (!r.ok) throw new Error(`Board failed: ${r.status}`);
        return r.json();
      })
      .then((rows) => {
        setTasks(rows);
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message || "Failed to load board");
        setLoading(false);
      });
  }, [auth.accessToken, id, filters]);

  useEffect(() => {
    if (!auth.accessToken || !id) return;
    fetch(`/api/v1/projects/${id}`, { headers: { Authorization: `Bearer ${auth.accessToken}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((proj) => {
        if (proj?.status_profile_id) {
          return fetch(`/api/v1/status-profiles/${proj.status_profile_id}`, {
            headers: { Authorization: `Bearer ${auth.accessToken}` },
          })
            .then((r) => (r.ok ? r.json() : null))
            .then((sp) => setStatuses((sp?.statuses ?? []).sort((a: StatusInfo, b: StatusInfo) => a.order - b.order)));
        }
      })
      .catch(() => undefined);
  }, [auth.accessToken, id]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  const childCounts = useMemo(() => {
    const m = new Map<number, number>();
    for (const t of tasks) {
      if (t.parent_id != null) m.set(t.parent_id, (m.get(t.parent_id) ?? 0) + 1);
    }
    return m;
  }, [tasks]);

  const columns = useMemo(() => {
    if (statuses.length === 0) {
      const m = new Map<string, BoardTask[]>();
      m.set("All tasks", tasks);
      return [...m.entries()].map(([name, rows]) => ({ key: name, name, statusId: -1, rows }));
    }
    return statuses.map((s) => ({
      key: String(s.id),
      name: s.name,
      statusId: s.id,
      rows: tasks.filter((t) => t.status_id === s.id),
    }));
  }, [statuses, tasks]);

  const today = TODAY();
  const todayCount = useMemo(
    () => tasks.filter((t) => (t.due_date || "").slice(0, 10) === today).length,
    [tasks, today]
  );

  const jumpToday = () => {
    const first = todayTaskRefs.current.values().next().value as HTMLDivElement | undefined;
    if (first) first.scrollIntoView({ behavior: "smooth", block: "center" });
    else boardRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const moveTask = (taskId: number, statusId: number) => {
    if (!auth.accessToken || statusId < 0) return;
    fetch(`/api/v1/tasks/${taskId}/status`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth.accessToken}`,
      },
      body: JSON.stringify({ status_id: statusId }),
    })
      .then((r) => {
        if (!r.ok) throw new Error(`Status change failed: ${r.status}`);
        return r.json();
      })
      .then(() => fetchTasks())
      .catch((e) => setError(e.message));
  };

  const exportBoardJson = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(tasks, null, 2));
    const a = document.createElement("a");
    a.setAttribute("href", dataStr);
    a.setAttribute("download", `board_project_${id}.json`);
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const exportBoardCsv = async () => {
    if (!auth.accessToken || !id) return;
    setExportError("");
    try {
      await downloadExport(
        buildTimelineExportUrl(id, "csv", filters.depth),
        auth.accessToken,
        `timeline_project_${id}.csv`
      );
    } catch (e) {
      setExportError(e instanceof Error ? e.message : "Export failed");
    }
  };

  const canDrag = auth.role !== "guest";
  const depthFilter = filters.depth || "all";

  return (
    <main className="p-6 bg-slate-950 min-h-screen text-slate-100">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold">Board</h1>
          <p className="text-xs text-slate-400 mt-1">
            Kanban by Status · depth 0 Task › 1.1 Subtask › 1.1.1 Microtask · drag-drop writes Status Period + history
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <div className="flex items-center gap-1 bg-slate-800 rounded p-1 border border-slate-700">
            <span className="px-2 text-slate-400">Depth:</span>
            {["all", "0", "1", "2"].map((d) => (
              <button
                key={d}
                onClick={() => setFilters({ ...filters, depth: d === "all" ? "" : d })}
                className={`px-2.5 py-1 rounded font-medium ${depthFilter === d ? "bg-indigo-600 text-white" : "text-slate-300"}`}
              >
                {d === "all" ? "All" : `Depth ${d}`}
              </button>
            ))}
          </div>
          <button
            onClick={jumpToday}
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 rounded border border-slate-700 font-medium"
            title={todayCount > 0 ? `${todayCount} task(s) due today` : "Scroll to today's due tasks"}
          >
            Jump Today
          </button>
          <button onClick={exportBoardJson} className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 rounded font-medium text-white">
            Export JSON
          </button>
          <button
            onClick={() => void exportBoardCsv()}
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 rounded border border-slate-700 font-medium"
          >
            Export CSV
          </button>
        </div>
      </div>

      <TaskFilters filters={filters} onChange={setFilters} statuses={statuses} />
      {loading && (
        <div role="status" className="mt-3 text-xs text-slate-400">
          Loading board…
        </div>
      )}
      {error && (
        <div role="alert" className="mt-3 text-xs text-rose-300">
          {error}
        </div>
      )}
      {exportError && (
        <div role="alert" className="mt-3 text-xs text-rose-300">
          {exportError}
        </div>
      )}

      <div ref={boardRef} className="mt-4 flex gap-3 overflow-x-auto pb-4">
        {columns.map((col) => (
          <section
            key={col.key}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (dragId != null && col.statusId >= 0) moveTask(dragId, col.statusId);
              setDragId(null);
            }}
            className="w-72 shrink-0 bg-slate-900/40 border border-slate-800 rounded-lg flex flex-col max-h-[65vh]"
          >
            <header className="px-3 py-2 border-b border-slate-800 text-sm font-semibold flex justify-between items-center">
              <span className="truncate">{col.name}</span>
              <span className="text-slate-400 font-mono text-xs">{col.rows.length}</span>
            </header>
            <div className="p-2 space-y-2 overflow-y-auto">
              {col.rows.map((t) => {
                const isTodayDue = (t.due_date || "").slice(0, 10) === today;
                return (
                  <div
                    key={t.id}
                    ref={(el) => {
                      if (el && isTodayDue) todayTaskRefs.current.set(t.id, el);
                      else todayTaskRefs.current.delete(t.id);
                    }}
                    draggable={canDrag}
                    onDragStart={() => setDragId(t.id)}
                    className={`bg-slate-900 border rounded p-2.5 text-xs cursor-grab ${
                      t.is_blocked ? "border-rose-700" : "border-slate-800"
                    } ${isTodayDue ? "ring-1 ring-amber-500/60" : ""}`}
                    title={canDrag ? "Drag to another column to change Status" : "Guests cannot move tasks"}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-slate-500">#{t.id} · depth {t.depth}</span>
                      <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 capitalize">{t.priority}</span>
                    </div>
                    <div className="mt-1 font-medium text-slate-100">
                      {t.is_blocked && <span className="text-rose-400 mr-1">●</span>}
                      {t.title}
                    </div>
                    <div className="mt-1 font-mono text-[11px] text-slate-400">
                      {t.start_date} → {t.due_date ?? "no due"}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1 text-[11px]">
                      {t.tag_names.map((tag) => (
                        <span key={tag} className="px-1.5 rounded bg-slate-800 text-slate-300">
                          {tag}
                        </span>
                      ))}
                      {t.assignee_ids.length > 0 && (
                        <span className="px-1.5 rounded bg-indigo-950 text-indigo-300 font-mono">
                          {t.assignee_ids.length} assignee(s)
                        </span>
                      )}
                      {(childCounts.get(t.id) ?? 0) > 0 && (
                        <span className="px-1.5 rounded bg-slate-800 text-slate-400">
                          {childCounts.get(t.id)} sub
                        </span>
                      )}
                    </div>
                    <div className="mt-1 font-mono text-[11px] text-slate-500">
                      est {t.estimate_mins ?? 0}m vs spent {t.time_spent_mins}m
                      {t.blocked_by_ids.length > 0 && (
                        <span className="text-rose-300"> · blocked by {t.blocked_by_ids.join(", ")}</span>
                      )}
                    </div>
                  </div>
                );
              })}
              {col.rows.length === 0 && (
                <div className="py-8 text-center text-slate-500 text-xs">No tasks — drop here to move.</div>
              )}
            </div>
          </section>
        ))}
      </div>
      {tasks.length === 0 && !loading && !error && (
        <div className="text-center text-slate-500 text-sm py-10">No tasks match the current filters.</div>
      )}
      <div className="mt-4 border-t border-slate-800 pt-2">{id && <TelemetryBar projectId={id} />}</div>
    </main>
  );
}
