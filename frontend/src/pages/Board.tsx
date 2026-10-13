import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import TaskFilters, { EMPTY_FILTERS, buildTaskQuery, type TaskFilterState } from "../components/TaskFilters";
import TelemetryBar from "../components/TelemetryBar";
import { useAuth } from "../stores/auth";
import TaskCreateModal from "../components/TaskCreateModal";
import TaskDialog from "../components/TaskDialog";
import { buildTimelineExportUrl, downloadExport } from "../utils/exports";
import { deriveStatusSignal, emptyStageSignal, kindLabel } from "../utils/statusSignals";
import { boardStageMoveBody, boardStatusMoveBody, formatTaskCode } from "../utils/boardCard";

interface BoardTask {
  id: number;
  title: string;
  status_id: number | null;
  stage_id?: number | null;
  depth: number;
  parent_id?: number | null;
  wbs?: string;
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

interface StageInfo {
  id: number;
  name: string;
  order: number;
  color_base: string;
}

interface StatusInfo {
  id: number;
  name: string;
  order: number;
  is_done?: boolean;
  is_milestone?: boolean;
  kind?: string;
  stage_id?: number | null;
  shade?: string | null;
  color?: string;
}

function signalClass(kind: string, isDone: boolean): string {
  if (isDone) return "text-emerald-400";
  if (kind === "blocked") return "text-rose-400 font-bold";
  if (kind === "attention") return "text-amber-400";
  if (kind === "cancelled") return "text-on-surface-variant opacity-60";
  if (kind === "on_hold") return "text-sky-300";
  return "text-on-surface-variant";
}

const TODAY = () => new Date().toISOString().slice(0, 10);

/**
 * Tiered Kanban Board (SPEC-v0.3 P2 / U5).
 * Stage header row (name, count, % done, collapse toggle) + expanded leaf
 * Status columns with horizontal scroll + shade chips. Drag-drop across
 * Statuses (incl. across Stages) via POST /tasks/{id}/status (upserts
 * Status Period + history). Profile resolves via parent Category live
 * reference (falls back to legacy project.status_profile_id).
 */
export default function Board() {
  const auth = useAuth();
  const { id } = useParams();
  const canDrag = auth.role !== "guest";
  const canCreate = auth.role !== "guest";
  const [modal, setModal] = useState<{ parentId: number | null; parentTitle?: string | null; kind: "Task" | "Subtask" | "Microtask" } | null>(null);
  const [editTaskId, setEditTaskId] = useState<number | null>(null);
  const [tasks, setTasks] = useState<BoardTask[]>([]);
  const [statuses, setStatuses] = useState<StatusInfo[]>([]);
  const [stages, setStages] = useState<StageInfo[]>([]);
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({});
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
    const headers = { Authorization: `Bearer ${auth.accessToken}` };
    fetch(`/api/v1/projects/${id}`, { headers })
      .then((r) => (r.ok ? r.json() : null))
      .then(async (proj) => {
        if (!proj) return;
        // U5 live reference: Project -> Category -> Profile.
        let profileId: number | null = proj.status_profile_id ?? null;
        if (proj.category_id) {
          try {
            const cr = await fetch(`/api/v1/categories/${proj.category_id}`, { headers });
            if (cr.ok) {
              const cat = await cr.json();
              if (cat?.status_profile_id) profileId = cat.status_profile_id;
            }
          } catch {
            // fall back to legacy project profile id
          }
        }
        if (!profileId) {
          setStatuses([]);
          setStages([]);
          return;
        }
        const sr = await fetch(`/api/v1/status-profiles/${profileId}`, { headers });
        if (sr.ok) {
          const sp = await sr.json();
          setStatuses((sp?.statuses ?? []).sort((a: StatusInfo, b: StatusInfo) => a.order - b.order));
          setStages((sp?.stages ?? []).sort((a: StageInfo, b: StageInfo) => a.order - b.order));
          return;
        }
        // Fallback for project-only members (category fetch 404s for them):
        // dashboard summary carries the same stages/statuses breakdown.
        try {
          const dr = await fetch(`/api/v1/dashboard/summary?project_id=${id}`, { headers });
          if (dr.ok) {
            const d = await dr.json();
            setStatuses((d?.statuses ?? []).sort((a: StatusInfo, b: StatusInfo) => a.order - b.order));
            setStages((d?.stages ?? []).sort((a: StageInfo, b: StageInfo) => a.order - b.order));
          }
        } catch {
          // leave empty; empty-state message covers it
        }
      })
      .catch(() => undefined);
  }, [auth.accessToken, id]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!canCreate || !id) return;
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        setModal({ parentId: null, kind: "Task" });
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [canCreate, id]);

  const childCounts = useMemo(() => {
    const m = new Map<number, number>();
    for (const t of tasks) {
      if (t.parent_id != null) m.set(t.parent_id, (m.get(t.parent_id) ?? 0) + 1);
    }
    return m;
  }, [tasks]);

  const statusById = useMemo(() => new Map(statuses.map((s) => [s.id, s])), [statuses]);

  const stageGroups = useMemo(() => {
    const activeStages = filters.stageId
      ? stages.filter((s) => String(s.id) === filters.stageId)
      : stages;
    if (activeStages.length === 0) {
      // No stages (legacy profile): single flat group of leaf columns.
      return [
        {
          stage: null as StageInfo | null,
          leaves: statuses.map((s, i) => ({
            key: String(s.id),
            name: s.name,
            statusId: s.id as number | null,
            stageId: null as number | null,
            shade: s.shade || s.color || "#6b7280",
            rows: tasks.filter((t) => t.status_id === s.id),
            done: !!s.is_done,
            kind: s.kind ?? "normal",
            sig: deriveStatusSignal(i, statuses.length, s.kind ?? "normal", !!s.is_done),
            sigLabel: kindLabel(s.kind ?? "normal", !!s.is_done),
            milestone: !!s.is_milestone,
          })),
        },
      ];
    }
    return activeStages.map((st) => {
      const inStage = statuses.filter((s) => s.stage_id === st.id);
      const leaves = inStage.map((s, i) => ({
        key: String(s.id),
        name: s.name,
        statusId: s.id as number | null,
        stageId: null as number | null,
        shade: s.shade || st.color_base,
        rows: tasks.filter((t) => t.status_id === s.id),
        done: !!s.is_done,
        kind: s.kind ?? "normal",
        sig: deriveStatusSignal(i, inStage.length, s.kind ?? "normal", !!s.is_done),
        sigLabel: kindLabel(s.kind ?? "normal", !!s.is_done),
        milestone: !!s.is_milestone,
      }));
      if (inStage.length === 0) {
        // ADR-0010: empty Stage renders as its own directly-assignable column.
        const sig = emptyStageSignal();
        leaves.push({
          key: `stage-${st.id}`,
          name: st.name,
          statusId: null,
          stageId: st.id,
          shade: st.color_base,
          rows: tasks.filter((t) => t.stage_id === st.id),
          done: false,
          kind: "normal",
          sig,
          sigLabel: "directly assigned",
          milestone: false,
        });
      }
      return { stage: st as StageInfo | null, leaves };
    });
  }, [stages, statuses, tasks, filters.stageId]);

  const stageStats = useMemo(() => {
    const m = new Map<number | string, { count: number; done: number }>();
    for (const g of stageGroups) {
      const key = g.stage ? g.stage.id : "flat";
      let count = 0;
      let done = 0;
      for (const leaf of g.leaves) {
        count += leaf.rows.length;
        if (leaf.done) done += leaf.rows.length;
      }
      m.set(key, { count, done });
    }
    return m;
  }, [stageGroups]);

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

  const toggleStage = (stageId: number) =>
    setCollapsed((prev) => ({ ...prev, [stageId]: !prev[stageId] }));

  const moveTask = (
    taskId: number,
    target: { statusId: number } | { stageId: number }
  ) => {
    if (!auth.accessToken) return;
    const body =
      "stageId" in target
        ? boardStageMoveBody(target.stageId)
        : boardStatusMoveBody(target.statusId, TODAY());
    if ("statusId" in target && target.statusId < 0) return;
    fetch(`/api/v1/tasks/${taskId}/status`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth.accessToken}`,
      },
      body: JSON.stringify(body),
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
        buildTimelineExportUrl(id, "csv", filters.depth, filters.stageId || undefined),
        auth.accessToken,
        `timeline_project_${id}.csv`
      );
    } catch (e) {
      setExportError(e instanceof Error ? e.message : "Export failed");
    }
  };

  const depthFilter = filters.depth || "all";

  const renderCard = (t: BoardTask) => {
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
        className={`bg-surface-container-lowest border rounded p-2.5 text-xs cursor-grab ${
          t.is_blocked ? "border-error" : "border-subtle"
        } ${isTodayDue ? "ring-1 ring-amber-500/60" : ""}`}
        title={canDrag ? "Drag to another column to change Status" : "Guests cannot move tasks"}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-outline">{formatTaskCode(t)} · depth {t.depth}</span>
          <span className="px-1.5 py-0.5 rounded bg-surface-container text-on-surface-variant capitalize">{t.priority}</span>
        </div>
        <div className="mt-1 font-medium text-on-surface">
          {t.is_blocked && <span className="text-rose-400 mr-1">●</span>}
          <button
            onClick={() => setEditTaskId(t.id)}
            className="hover:text-primary hover:underline text-left"
            title="Edit task (status, dates, assignee, comments)"
          >
            {t.title}
          </button>
        </div>
        <div className="mt-1 font-mono text-[11px] text-on-surface-variant">
          {t.start_date} → {t.due_date ?? "no due"}
        </div>
        <div className="mt-1 flex flex-wrap gap-1 text-[11px]">
          {t.tag_names.map((tag) => (
            <span key={tag} className="px-1.5 rounded bg-surface-container text-on-surface-variant">
              {tag}
            </span>
          ))}
          {t.assignee_ids.length > 0 && (
            <span className="px-1.5 rounded bg-primary-fixed text-primary font-mono">
              {t.assignee_ids.length} assignee(s)
            </span>
          )}
          {(childCounts.get(t.id) ?? 0) > 0 && (
            <span className="px-1.5 rounded bg-surface-container text-on-surface-variant">
              {childCounts.get(t.id)} sub
            </span>
          )}
        </div>
        <div className="mt-1 font-mono text-[11px] text-outline">
          est {t.estimate_mins ?? 0}m vs spent {t.time_spent_mins}m
          {t.is_blocked && <span className="ml-1 px-1.5 py-0.5 rounded bg-error-container text-error font-bold">⛔ blocked</span>}
        </div>
        {t.blocked_by_ids.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1 text-[11px]">
            <span className="text-outline">depends on:</span>
            {t.blocked_by_ids.map((depId) => (
              <button
                key={depId}
                onClick={() => setEditTaskId(depId)}
                className="px-1.5 rounded border border-error text-error hover:underline font-mono"
                title={`Open blocking task #${depId}`}
              >
                #{depId}
              </button>
            ))}
          </div>
        )}
        {canCreate && t.depth < 2 && (
          <button
            onClick={() =>
              setModal({
                parentId: t.id,
                parentTitle: t.title,
                kind: t.depth === 0 ? "Subtask" : "Microtask",
              })
            }
            className="mt-1.5 text-[11px] text-primary hover:text-primary"
          >
            {t.depth === 0 ? "+Add Subtask" : "+Add Microtask"}
          </button>
        )}
      </div>
    );
  };

  return (
    <main className="p-6 bg-surface min-h-screen text-on-surface">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold">Board</h1>
          <p className="text-xs text-on-surface-variant mt-1">
            Tiered by Stage · depth 0 Task › 1.1 Subtask › 1.1.1 Microtask · drag-drop writes Status Period + history
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <div className="flex items-center gap-1 bg-surface-container rounded p-1 border border-subtle">
            <span className="px-2 text-on-surface-variant">Depth:</span>
            {["all", "0", "1", "2"].map((d) => (
              <button
                key={d}
                onClick={() => setFilters({ ...filters, depth: d === "all" ? "" : d })}
                className={`px-2.5 py-1 rounded font-medium ${depthFilter === d ? "bg-primary-container text-on-primary" : "text-on-surface-variant"}`}
              >
                {d === "all" ? "All" : `Depth ${d}`}
              </button>
            ))}
          </div>
          {id && (
            <button
              onClick={() => {
                if (auth.role === "guest") {
                  alert("Guest role cannot create tasks. Please log in as a member, manager, or admin.");
                  return;
                }
                setModal({ parentId: null, kind: "Task" });
              }}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 rounded-lg font-semibold text-on-primary shadow-lg shadow-emerald-900/30 flex items-center gap-1.5 transition-all text-xs ring-2 ring-emerald-400/30 cursor-pointer"
              title="Press '+' or click to add task"
            >
              <span className="text-sm font-bold">+</span> Add Task
            </button>
          )}
          <button
            onClick={jumpToday}
            className="px-3 py-1.5 bg-surface-container hover:bg-surface-container-high rounded border border-subtle font-medium"
            title={todayCount > 0 ? `${todayCount} task(s) due today` : "Scroll to today's due tasks"}
          >
            Jump Today
          </button>
          <button onClick={exportBoardJson} className="px-3 py-1.5 bg-primary-container hover:bg-primary rounded font-medium text-on-primary">
            Export JSON
          </button>
          <button
            onClick={() => void exportBoardCsv()}
            className="px-3 py-1.5 bg-surface-container hover:bg-surface-container-high rounded border border-subtle font-medium"
          >
            Export CSV
          </button>
        </div>
      </div>

      <TaskFilters
        filters={filters}
        onChange={setFilters}
        statuses={statuses.map((s) => ({ id: s.id, name: s.name, stage_id: s.stage_id ?? null }))}
        stages={stages.map((s) => ({ id: s.id, name: s.name }))}
      />
      {loading && (
        <div role="status" className="mt-3 text-xs text-on-surface-variant">
          Loading board…
        </div>
      )}
      {error && (
        <div role="alert" className="mt-3 text-xs text-error">
          {error}
        </div>
      )}
      {exportError && (
        <div role="alert" className="mt-3 text-xs text-error">
          {exportError}
        </div>
      )}

      <div ref={boardRef} className="mt-4 space-y-4">
        {stageGroups.map((group) => {
          const key = group.stage ? group.stage.id : "flat";
          const stats = stageStats.get(key) ?? { count: 0, done: 0 };
          const pct = stats.count > 0 ? Math.round((stats.done / stats.count) * 100) : 0;
          const isCollapsed = group.stage ? !!collapsed[group.stage.id] : false;
          return (
            <section key={String(key)} className="border border-subtle rounded-lg overflow-hidden">
              {group.stage && (
                <header className="flex items-center justify-between gap-3 px-4 py-2.5 bg-surface-container-lowest">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="w-3 h-3 rounded-full shrink-0"
                      style={{ backgroundColor: group.stage.color_base }}
                      title={`Stage color ${group.stage.color_base}`}
                    />
                    <h2 className="text-sm font-semibold truncate">{group.stage.name}</h2>
                    <span className="text-xs font-mono text-on-surface-variant">
                      {stats.count} task(s) · {pct}% done
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="w-28 h-1.5 rounded bg-surface-container overflow-hidden" title={`${pct}% done`}>
                      <div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} />
                    </div>
                    <button
                      onClick={() => toggleStage(group.stage!.id)}
                      className="px-2.5 py-1 rounded bg-surface-container hover:bg-surface-container-high border border-subtle text-xs font-medium"
                      aria-expanded={!isCollapsed}
                    >
                      {isCollapsed ? "Expand" : "Collapse"}
                    </button>
                  </div>
                </header>
              )}
              {!isCollapsed && (
                <div className="flex gap-3 overflow-x-auto p-3">
                  {group.leaves.map((col) => (
                    <section
                      key={col.key}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => {
                        if (dragId != null) {
                          if (col.stageId != null) moveTask(dragId, { stageId: col.stageId });
                          else if ((col.statusId ?? -1) >= 0)
                            moveTask(dragId, { statusId: col.statusId as number });
                        }
                        setDragId(null);
                      }}
                      className="w-72 shrink-0 bg-surface-container-low border border-subtle rounded-lg flex flex-col max-h-[65vh]"
                    >
                      <header className="px-3 py-2 border-b border-subtle text-sm font-semibold flex justify-between items-center gap-2">
                        <span className="flex items-center gap-1.5 truncate">
                          <span
                            className="w-2.5 h-2.5 rounded shrink-0"
                            style={{ backgroundColor: col.shade }}
                            title={`Shade ${col.shade}`}
                          />
                          <span className="truncate">{col.name}</span>
                          <span
                            role="img"
                            aria-label={`Status signal: ${col.sig.glyph} ${col.sig.weight}% ${col.sigLabel}`}
                            title={`${col.sig.weight}% within stage · ${col.sigLabel}${col.milestone ? " · milestone" : ""}`}
                            className={`font-mono text-[11px] font-normal shrink-0 ${signalClass(col.kind, col.done)}`}
                          >
                            {col.sig.glyph} {col.sig.weight}%{col.milestone ? " ★" : ""}
                          </span>
                        </span>
                        <span className="text-on-surface-variant font-mono text-xs">{col.rows.length}</span>
                      </header>
                      <div className="p-2 space-y-2 overflow-y-auto">
                        {col.rows.map((t) => renderCard(t))}
                        {col.rows.length === 0 && (
                          <div className="py-8 text-center text-outline text-xs">No tasks — drop here to move.</div>
                        )}
                      </div>
                    </section>
                  ))}
                  {group.leaves.length === 0 && (
                    <div className="py-6 px-4 text-xs text-outline">
                      No leaf Statuses in this Stage yet — add one in Category settings.
                    </div>
                  )}
                </div>
              )}
              {isCollapsed && (
                <div className="px-4 py-2 text-xs text-outline">
                  Collapsed — {stats.count} task(s), {stats.done} done. Expand to see leaf columns.
                </div>
              )}
            </section>
          );
        })}
      </div>
      {tasks.length === 0 && !loading && !error && (
        <div className="text-center text-outline text-sm py-10">No tasks match the current filters.</div>
      )}
      {statusById.size === 0 && !loading && (
        <div className="text-center text-outline text-xs py-4">
          No Statuses in this Category profile yet.
        </div>
      )}
      <div className="mt-4 border-t border-subtle pt-2">{id && <TelemetryBar projectId={id} />}</div>
      {modal && id && (
        <TaskCreateModal
          projectId={id}
          parentId={modal.parentId}
          parentTitle={modal.parentTitle}
          kind={modal.kind}
          onClose={() => setModal(null)}
          onCreated={fetchTasks}
        />
      )}
      {editTaskId != null && id && (
        <TaskDialog
          projectId={id}
          mode="edit"
          taskId={editTaskId}
          onClose={() => setEditTaskId(null)}
          onUpdated={fetchTasks}
        />
      )}
    </main>
  );
}
