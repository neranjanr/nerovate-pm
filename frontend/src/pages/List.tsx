import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import TaskFilters, { EMPTY_FILTERS, buildTaskQuery, type TaskFilterState } from "../components/TaskFilters";
import TelemetryBar from "../components/TelemetryBar";
import { useAuth } from "../stores/auth";
import TaskCreateModal from "../components/TaskCreateModal";
import {
  buildChildrenMap,
  getVisibleTreeTasks,
  getDescendantStats,
  getWbsNumber,
  canDropAsSiblings,
  getSiblingPosition,
  getReorderDisabledReason,
  formatReorderConfirm,
  type TreeTask,
} from "../utils/wbsTree";

interface TaskItem {
  id: number;
  title: string;
  status_id: number;
  depth: number;
  parent_id?: number | null;
  start_date: string;
  due_date?: string | null;
  assignee_ids: number[];
  is_blocked: boolean;
}

interface StatusInfo {
  id: number;
  name: string;
  is_done?: boolean;
}

export default function List() {
  const auth = useAuth();
  const { id } = useParams();
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [timelineTasks, setTimelineTasks] = useState<TreeTask[]>([]);
  const [statuses, setStatuses] = useState<StatusInfo[]>([]);
  const [filters, setFilters] = useState<TaskFilterState>({ ...EMPTY_FILTERS });
  const [groupBy, setGroupBy] = useState<"status" | "assignee" | "none">("status");
  const [savedGroupBy, setSavedGroupBy] = useState<"status" | "assignee" | "none">("status");
  const [isTreeMode, setIsTreeMode] = useState<boolean>(false);
  const [treeDefault, setTreeDefault] = useState<"tasks-only" | "tasks-subtasks" | "all">("all");
  const [collapsedIds, setCollapsedIds] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [modal, setModal] = useState<{ parentId: number | null; parentTitle?: string | null; kind: "Task" | "Subtask" | "Microtask" } | null>(null);
  const [reorderModal, setReorderModal] = useState<{
    draggedTask: TreeTask;
    targetTask: TreeTask;
    oldPos: number;
    newPos: number;
    wbs: string;
  } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const canCreate = auth.role !== "guest";
  const isFiltered = Boolean(
    filters.search.trim() ||
      filters.statusId ||
      filters.stageId ||
      filters.assigneeId ||
      filters.watcherId ||
      filters.tag.trim() ||
      filters.depth ||
      filters.blocked ||
      filters.overdue
  );
  const canReorder = auth.role !== "guest" && !isFiltered;

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
            .then((sp) => setStatuses(sp?.statuses ?? []));
        }
      })
      .catch(() => undefined);
  }, [auth.accessToken, id]);

  const fetchTimelineData = useCallback(() => {
    if (!auth.accessToken || !id) return;
    setLoading(true);
    const headers = { Authorization: `Bearer ${auth.accessToken}` };
    Promise.all([
      fetch(`/api/v1/projects/${id}/timeline`, { headers }).then((r) => (r.ok ? r.json() : [])),
      fetch(`/api/v1/projects/${id}/tree-default`, { headers }).then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([rows, treeDef]) => {
        setTimelineTasks(rows);
        if (treeDef?.tree_default) {
          setTreeDefault(treeDef.tree_default);
        }
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message || "Failed to load tree");
        setLoading(false);
      });
  }, [auth.accessToken, id]);

  useEffect(() => {
    if (isTreeMode) {
      fetchTimelineData();
    } else {
      if (!auth.accessToken || !id) return;
      setLoading(true);
      const q = buildTaskQuery(id, filters);
      fetch(`/api/v1/tasks?${q}`, { headers: { Authorization: `Bearer ${auth.accessToken}` } })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`List failed: ${r.status}`))))
        .then((rows) => {
          setTasks(rows);
          setLoading(false);
        })
        .catch((e) => {
          setError(e.message);
          setLoading(false);
        });
    }
  }, [auth.accessToken, id, filters, refreshKey, isTreeMode, fetchTimelineData]);

  const handleTreeDefaultChange = async (newDefault: "tasks-only" | "tasks-subtasks" | "all") => {
    setTreeDefault(newDefault);
    if (!auth.accessToken || !id) return;
    try {
      await fetch(`/api/v1/projects/${id}/tree-default`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth.accessToken}`,
        },
        body: JSON.stringify({ tree_default: newDefault }),
      });
    } catch {
      // ignore
    }
  };

  const childrenMap = useMemo(() => buildChildrenMap(timelineTasks), [timelineTasks]);

  const collapseAll = () => {
    const parentIds = new Set<number>();
    for (const [pid, kids] of childrenMap.entries()) {
      if (pid !== null && kids.length > 0) {
        parentIds.add(pid);
      }
    }
    for (const t of timelineTasks) {
      if ((childrenMap.get(t.task_id) || []).length > 0) {
        parentIds.add(t.task_id);
      }
    }
    setCollapsedIds(parentIds);
  };

  const expandAll = () => {
    setCollapsedIds(new Set());
  };

  const visibleTreeTasks = useMemo(() => {
    return getVisibleTreeTasks(timelineTasks, treeDefault, collapsedIds);
  }, [timelineTasks, treeDefault, collapsedIds]);

  const groups = useMemo(() => {
    if (groupBy === "none") return new Map<string, TaskItem[]>([["All tasks", tasks]]);
    const m = new Map<string, TaskItem[]>();
    for (const t of tasks) {
      if (groupBy === "status") {
        const s = statuses.find((x) => x.id === t.status_id);
        const key = s ? s.name : `Status ${t.status_id}`;
        m.set(key, [...(m.get(key) ?? []), t]);
      } else {
        const key = t.assignee_ids.length ? t.assignee_ids.map((a) => `User ${a}`).join(", ") : "Unassigned";
        for (const k of t.assignee_ids.length ? t.assignee_ids.map((a) => `User ${a}`) : ["Unassigned"]) {
          m.set(k, [...(m.get(k) ?? []), t]);
        }
      }
    }
    return m;
  }, [tasks, groupBy, statuses]);

  const toggleTreeMode = () => {
    if (!isTreeMode) {
      if (groupBy !== "none") setSavedGroupBy(groupBy);
      setGroupBy("none");
      setIsTreeMode(true);
    } else {
      setIsTreeMode(false);
      setGroupBy(savedGroupBy);
    }
  };

  return (
    <main className="p-6 bg-slate-950 min-h-screen text-slate-100">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <h1 className="text-xl font-semibold">List</h1>
        <div className="flex items-center gap-2 text-xs flex-wrap">
          {canCreate && (
            <button
              onClick={() => setModal({ parentId: null, kind: "Task" })}
              className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 rounded font-medium text-white"
            >
              +Add Task
            </button>
          )}
          <button
            onClick={toggleTreeMode}
            className={`px-3 py-1.5 rounded font-medium border transition-colors ${
              isTreeMode ? "bg-indigo-600 border-indigo-500 text-white" : "bg-slate-800 border-slate-700 text-slate-300 hover:text-white"
            }`}
          >
            {isTreeMode ? "Tree Mode: ON" : "Tree Mode"}
          </button>
          <div className="flex flex-col gap-1">
            <div className={`flex items-center gap-1 bg-slate-800 rounded p-1 border border-slate-700 ${isTreeMode ? "opacity-50 cursor-not-allowed" : ""}`}>
              {(["status", "assignee", "none"] as const).map((g) => (
                <button
                  key={g}
                  disabled={isTreeMode}
                  onClick={() => setGroupBy(g)}
                  className={`px-2.5 py-1 rounded capitalize ${groupBy === g ? "bg-indigo-600 text-white" : "text-slate-300"} ${isTreeMode ? "cursor-not-allowed" : ""}`}
                >
                  {g === "none" ? "No grouping" : `By ${g}`}
                </button>
              ))}
            </div>
            {isTreeMode && <span className="text-[10px] text-amber-300/80">Grouping disabled in tree mode</span>}
          </div>
        </div>
      </div>

      {/* Tree Mode Toolbar (matches Timeline) */}
      {isTreeMode && (
        <div className="bg-slate-900/80 border border-slate-800 rounded p-3 mb-4 flex items-center justify-between gap-3 text-xs flex-wrap">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 bg-slate-800 rounded p-1 border border-slate-700">
              <span className="px-2 text-slate-400">Tree view:</span>
              {(["tasks-only", "tasks-subtasks", "all"] as const).map((d) => (
                <button
                  key={d}
                  onClick={() => handleTreeDefaultChange(d)}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                    treeDefault === d ? "bg-indigo-600 text-white" : "text-slate-300 hover:text-white"
                  }`}
                >
                  {d === "tasks-only" ? "Tasks only" : d === "tasks-subtasks" ? "Tasks+Subtasks" : "All"}
                </button>
              ))}
            </div>
            <button
              onClick={collapseAll}
              className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-700 font-medium transition-colors text-xs"
            >
              Collapse All
            </button>
            <button
              onClick={expandAll}
              className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-700 font-medium transition-colors text-xs"
            >
              Expand All
            </button>
          </div>
          <div className="text-slate-400 font-mono text-xs">
            Total items: {timelineTasks.length} (visible: {visibleTreeTasks.length})
          </div>
        </div>
      )}

      {!isTreeMode && <TaskFilters filters={filters} onChange={setFilters} statuses={statuses} />}

      {loading && <div role="status" className="mt-3 text-xs text-slate-400">Loading tasks…</div>}
      {error && <div role="alert" className="mt-3 text-xs text-rose-300">{error}</div>}

      {/* Tree Mode View */}
      {isTreeMode ? (
        <div className="mt-4 bg-slate-900/40 border border-slate-800 rounded overflow-hidden">
          <div className="grid grid-cols-12 bg-slate-900 border-b border-slate-800 px-4 py-2.5 text-xs font-semibold text-slate-400">
            <div className="col-span-2">WBS</div>
            <div className="col-span-5">Task Name</div>
            <div className="col-span-3">Status</div>
            <div className="col-span-2 text-right">Due Date</div>
          </div>
          <div className="divide-y divide-slate-800/60">
            {visibleTreeTasks.map((t) => {
              const wbsCode = t.wbs || getWbsNumber(timelineTasks.indexOf(t), timelineTasks);
              const kids = childrenMap.get(t.task_id) || [];
              const hasKids = kids.length > 0;
              const isCollapsed = collapsedIds.has(t.task_id);
              const indentClass = t.depth === 1 ? "pl-4" : t.depth === 2 ? "pl-8" : "pl-0";
              const stats = hasKids && isCollapsed ? getDescendantStats(t.task_id, childrenMap, statuses) : null;
              return (
                <div
                  key={t.task_id}
                  draggable={canReorder}
                  title={getReorderDisabledReason(auth.role, isFiltered) ?? "Drag to reorder sibling"}
                  onDragStart={(e) => {
                    if (!canReorder) return;
                    e.dataTransfer.setData("text/plain", String(t.task_id));
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = canReorder ? "move" : "none";
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (!canReorder) return;
                    const draggedId = Number(e.dataTransfer.getData("text/plain"));
                    if (!draggedId || draggedId === t.task_id) return;
                    const draggedTask = timelineTasks.find((x) => x.task_id === draggedId);
                    if (!draggedTask) return;
                    if (!canDropAsSiblings(draggedTask, t)) {
                      alert("Cross-parent reorder not allowed");
                      return;
                    }
                    const oldPos = getSiblingPosition(draggedTask, timelineTasks);
                    const newPos = getSiblingPosition(t, timelineTasks);
                    const wbs = draggedTask.wbs || getWbsNumber(timelineTasks.indexOf(draggedTask), timelineTasks);
                    setReorderModal({
                      draggedTask,
                      targetTask: t,
                      oldPos,
                      newPos,
                      wbs,
                    });
                  }}
                  className={`grid grid-cols-12 px-4 py-3 text-xs items-center hover:bg-slate-900/60 transition-colors ${
                    canReorder ? "cursor-grab active:cursor-grabbing" : ""
                  }`}
                >
                  <div className="col-span-2 font-mono text-slate-400 font-semibold">{wbsCode}</div>
                  <div className={`col-span-5 font-medium text-slate-200 truncate flex items-center gap-1.5 ${indentClass}`}>
                    {hasKids ? (
                      <button
                        onClick={() => {
                          setCollapsedIds((prev) => {
                            const next = new Set(prev);
                            if (next.has(t.task_id)) next.delete(t.task_id);
                            else next.add(t.task_id);
                            return next;
                          });
                        }}
                        className="w-4 h-4 text-slate-400 hover:text-white shrink-0 font-mono text-[10px] flex items-center justify-center bg-slate-800 rounded border border-slate-700"
                        aria-label={isCollapsed ? "Expand" : "Collapse"}
                      >
                        {isCollapsed ? "▸" : "▾"}
                      </button>
                    ) : (
                      <span className="w-4 shrink-0" />
                    )}
                    {t.is_blocked && <span className="text-rose-400 mr-1" title="Blocked">⚠️</span>}
                    <span className="truncate">{t.title}</span>
                    {stats && (
                      <span className="ml-2 font-mono text-[10px] text-indigo-300 bg-indigo-950/60 px-1.5 py-0.5 rounded border border-indigo-900 shrink-0">
                        +{stats.total} children, {stats.completed} Complete
                      </span>
                    )}
                    {canCreate && t.depth < 2 && (
                      <button
                        onClick={() =>
                          setModal({
                            parentId: t.task_id,
                            parentTitle: t.title,
                            kind: t.depth === 0 ? "Subtask" : "Microtask",
                          })
                        }
                        className="ml-auto text-[11px] text-indigo-300 hover:text-indigo-200 shrink-0"
                      >
                        {t.depth === 0 ? "+Add Subtask" : "+Add Microtask"}
                      </button>
                    )}
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
            {visibleTreeTasks.length === 0 && !loading && (
              <div className="py-12 text-center text-slate-500 text-sm">No tasks found for the current tree view filter.</div>
            )}
          </div>
        </div>
      ) : (
        /* Flat / Grouped List View */
        <div className="mt-4 space-y-5">
          {[...groups.entries()].map(([name, rows]) => (
            <section key={name} className="bg-slate-900/40 border border-slate-800 rounded">
              <header className="px-4 py-2 border-b border-slate-800 text-sm font-semibold text-slate-200 flex justify-between">
                <span>{name}</span>
                <span className="text-slate-400 font-mono text-xs">{rows.length}</span>
              </header>
              <ul className="divide-y divide-slate-800/60">
                {rows.map((t) => (
                  <li key={t.id} className="px-4 py-2 text-sm flex items-center justify-between gap-3">
                    <span className="truncate">
                      {t.is_blocked && <span className="text-rose-400 mr-1">●</span>}
                      <span className="font-mono text-slate-500 mr-2">#{t.id}</span>
                      {t.title}
                    </span>
                    <span className="flex items-center gap-2 shrink-0">
                      <span className="text-xs text-slate-400 font-mono">
                        depth {t.depth} · {t.due_date ?? "no due"}
                      </span>
                      {canCreate && t.depth < 2 && (
                        <button
                          onClick={() =>
                            setModal({
                              parentId: t.id,
                              parentTitle: t.title,
                              kind: t.depth === 0 ? "Subtask" : "Microtask",
                            })
                          }
                          className="text-[11px] text-indigo-300 hover:text-indigo-200"
                        >
                          {t.depth === 0 ? "+Add Subtask" : "+Add Microtask"}
                        </button>
                      )}
                    </span>
                  </li>
                ))}
                {rows.length === 0 && <li className="px-4 py-6 text-center text-slate-500 text-sm">No tasks.</li>}
              </ul>
            </section>
          ))}
          {tasks.length === 0 && !loading && <div className="text-center text-slate-500 text-sm py-10">No tasks match the current filters.</div>}
        </div>
      )}

      <div className="mt-4 border-t border-slate-800 pt-2">{id && <TelemetryBar projectId={id} />}</div>
      {modal && id && (
        <TaskCreateModal
          projectId={id}
          parentId={modal.parentId}
          parentTitle={modal.parentTitle}
          kind={modal.kind}
          onClose={() => setModal(null)}
          onCreated={() => setRefreshKey((k) => k + 1)}
        />
      )}
      {reorderModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-lg border border-slate-700 bg-slate-900 p-4">
            <h2 className="text-sm font-semibold text-slate-100">Confirm Reorder</h2>
            <p className="mt-2 text-xs font-mono text-indigo-300 bg-indigo-950/60 p-2 rounded border border-indigo-900">
              {formatReorderConfirm(
                reorderModal.wbs,
                reorderModal.draggedTask.title,
                reorderModal.oldPos,
                reorderModal.newPos
              )}
            </p>
            <div className="mt-4 flex justify-end gap-2 text-xs">
              <button
                onClick={() => setReorderModal(null)}
                className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  if (!auth.accessToken) return;
                  try {
                    const r = await fetch("/api/v1/tasks/reorder", {
                      method: "POST",
                      headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${auth.accessToken}`,
                      },
                      body: JSON.stringify({
                        item_id: reorderModal.draggedTask.task_id,
                        to_position: reorderModal.newPos,
                      }),
                    });
                    if (!r.ok) {
                      const err = await r.json().catch(() => ({}));
                      throw new Error(err.detail || `Reorder failed: ${r.status}`);
                    }
                    setReorderModal(null);
                    fetchTimelineData();
                  } catch (e) {
                    alert(e instanceof Error ? e.message : "Reorder failed");
                    setReorderModal(null);
                  }
                }}
                className="px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white font-medium"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
