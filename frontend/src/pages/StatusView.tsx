import { useEffect, useMemo, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import { useAuth } from "../stores/auth";
import TaskDialog from "../components/TaskDialog";
import TaskDrawer from "../components/TaskDrawer";

interface StatusInfo {
  id: number;
  name: string;
  order?: number;
  is_done?: boolean;
}

interface StageInfo {
  id: number;
  name: string;
  order?: number;
}

interface StatusTask {
  id: number;
  project_id: number;
  parent_id?: number | null;
  depth: number;
  title: string;
  // ADR-0010: null when directly assigned onto an empty Stage (see stage_id).
  status_id: number | null;
  stage_id?: number | null;
  wbs?: string;
  due_date?: string | null;
  assignee_ids: number[];
  is_blocked: boolean;
}

interface ProjectRef {
  id: number;
  code: string;
  name: string;
}

/**
 * Status View (samplestatus.html, wired to real data).
 * - Project mode (/projects/:id/status): Tasks of one Project grouped by leaf Status.
 * - Category mode (/categories/:id/status): Tasks across the Category's Projects,
 *   grouped by leaf Status with a Parent Project column.
 * - Tasks only by default; expand a Task to reveal Subtasks, then Microtasks.
 * - Right rail is live counts only (Status Health + Project/Depth distribution).
 *   No Priority / velocity / bottleneck — backend has no such fields in v1.
 */
export default function StatusView() {
  const auth = useAuth();
  const { id } = useParams();
  const location = useLocation();
  const isCategoryMode = location.pathname.startsWith("/categories/");
  const scopeId = Number(id);

  const [tasks, setTasks] = useState<StatusTask[]>([]);
  const [statuses, setStatuses] = useState<StatusInfo[]>([]);
  const [stages, setStages] = useState<StageInfo[]>([]);
  const [projects, setProjects] = useState<ProjectRef[]>([]);
  const [scopeName, setScopeName] = useState("");
  const [collapsedIds, setCollapsedIds] = useState<Set<number>>(new Set());
  const [drawer, setDrawer] = useState<{ id: number; projectId: number } | null>(null);
  const [edit, setEdit] = useState<{ id: number; projectId: number } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!auth.accessToken || !scopeId) return;
    setLoading(true);
    setError("");
    const headers = { Authorization: `Bearer ${auth.accessToken}` };

    const load = async () => {
      try {
        let profileId: number | null = null;
        if (isCategoryMode) {
          const [cat, projs] = await Promise.all([
            fetch(`/api/v1/categories/${scopeId}`, { headers }).then((r) =>
              r.ok ? r.json() : null
            ),
            fetch(`/api/v1/categories/${scopeId}/projects`, { headers }).then((r) =>
              r.ok ? r.json() : []
            ),
          ]);
          setProjects(projs ?? []);
          setScopeName(cat?.name ?? `Category ${scopeId}`);
          profileId = cat?.status_profile_id ?? null;
        } else {
          const proj = await fetch(`/api/v1/projects/${scopeId}`, { headers }).then((r) =>
            r.ok ? r.json() : null
          );
          setScopeName(proj ? `${proj.code} · ${proj.name}` : `Project ${scopeId}`);
          profileId = proj?.status_profile_id ?? null;
        }

        if (profileId) {
          const sp = await fetch(`/api/v1/status-profiles/${profileId}`, {
            headers,
          }).then((r) => (r.ok ? r.json() : null));
          const list: StatusInfo[] = (sp?.statuses ?? []).slice().sort(
            (a: StatusInfo, b: StatusInfo) => (a.order ?? 0) - (b.order ?? 0)
          );
          setStatuses(list);
          setStages(
            (sp?.stages ?? [])
              .slice()
              .sort((a: StageInfo, b: StageInfo) => (a.order ?? 0) - (b.order ?? 0))
          );
        } else {
          setStatuses([]);
          setStages([]);
        }

        const qs = isCategoryMode
          ? `category_id=${scopeId}`
          : `project_id=${scopeId}`;
        const rows: StatusTask[] = await fetch(`/api/v1/tasks?${qs}`, {
          headers,
        }).then((r) => {
          if (!r.ok) throw new Error(`Status view failed: ${r.status}`);
          return r.json();
        });
        setTasks(rows);
        // Default: Tasks only — collapse every parent so Subtasks/Microtasks
        // stay hidden until the user expands them.
        const parents = new Set<number>();
        const ids = new Set(rows.map((t) => t.id));
        for (const t of rows) {
          if (t.parent_id != null && ids.has(t.parent_id)) parents.add(t.parent_id);
        }
        // Also collapse Tasks that have children even if child rows arrive later
        // via parent_id reference only.
        setCollapsedIds(parents);
        setLoading(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load status view");
        setLoading(false);
      }
    };
    load();
  }, [auth.accessToken, scopeId, isCategoryMode, refreshKey]);

  const childrenMap = useMemo(() => {
    const m = new Map<number | null, StatusTask[]>();
    for (const t of tasks) {
      const key = t.parent_id ?? null;
      m.set(key, [...(m.get(key) ?? []), t]);
    }
    return m;
  }, [tasks]);

  const statusById = useMemo(
    () => new Map(statuses.map((s) => [s.id, s])),
    [statuses]
  );
  const projectById = useMemo(
    () => new Map(projects.map((p) => [p.id, p])),
    [projects]
  );

  const stageById = useMemo(() => new Map(stages.map((s) => [s.id, s])), [stages]);

  // Top-level Tasks (depth 0) grouped by assignable node: leaf Status first
  // (Profile order), then direct empty-Stage buckets (ADR-0010).
  const groups = useMemo(() => {
    const tops = tasks.filter((t) => t.depth === 0);
    const order = new Map(statuses.map((s, i) => [s.id, i]));
    const buckets = new Map<number, StatusTask[]>();
    const stageBuckets = new Map<number, StatusTask[]>();
    for (const t of tops) {
      if (t.status_id != null) {
        buckets.set(t.status_id, [...(buckets.get(t.status_id) ?? []), t]);
      } else if (t.stage_id != null) {
        stageBuckets.set(t.stage_id, [...(stageBuckets.get(t.stage_id) ?? []), t]);
      }
    }
    const known = statuses.map((s) => s.id).filter((sid) => buckets.has(sid));
    const unknown = [...buckets.keys()]
      .filter((sid) => !order.has(sid))
      .sort((a, b) => a - b);
    const leafGroups = [...known, ...unknown].map((sid) => ({
      key: `status:${sid}`,
      statusName: statusById.get(sid)?.name ?? `Status ${sid}`,
      rows: buckets.get(sid) ?? [],
    }));
    const stageGroups = [...stageBuckets.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([sid, rows]) => ({
        key: `stage:${sid}`,
        statusName: `${stageById.get(sid)?.name ?? `Stage ${sid}`} ● 100%`,
        rows,
      }));
    return [...leafGroups, ...stageGroups];
  }, [tasks, statuses, statusById, stageById]);

  // Right rail: live counts over ALL fetched rows (any depth) by Status.
  const health = useMemo(() => {
    const counts = new Map<number, number>();
    const stageCounts = new Map<number, number>();
    for (const t of tasks) {
      if (t.status_id != null) counts.set(t.status_id, (counts.get(t.status_id) ?? 0) + 1);
      else if (t.stage_id != null)
        stageCounts.set(t.stage_id, (stageCounts.get(t.stage_id) ?? 0) + 1);
    }
    return { counts, stageCounts, total: tasks.length };
  }, [tasks]);

  const projectDist = useMemo(() => {
    const counts = new Map<number, number>();
    for (const t of tasks) counts.set(t.project_id, (counts.get(t.project_id) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [tasks]);

  const depthDist = useMemo(() => {
    const c = [0, 0, 0];
    for (const t of tasks) if (t.depth >= 0 && t.depth <= 2) c[t.depth] += 1;
    return [
      { label: "Tasks", count: c[0] },
      { label: "Subtasks", count: c[1] },
      { label: "Microtasks", count: c[2] },
    ];
  }, [tasks]);

  const toggle = (taskId: number) =>
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });

  const collapseAll = () => {
    const parents = new Set<number>();
    const ids = new Set(tasks.map((t) => t.id));
    for (const t of tasks) {
      if (t.parent_id != null && ids.has(t.parent_id)) parents.add(t.parent_id);
    }
    setCollapsedIds(parents);
  };
  const expandAll = () => setCollapsedIds(new Set());

  const renderChildren = (parentId: number, indent: number): React.ReactNode => {
    if (collapsedIds.has(parentId)) return null;
    const kids = childrenMap.get(parentId) ?? [];
    return (
      <>
        {kids.map((k) => {
          const hasKids = (childrenMap.get(k.id) ?? []).length > 0;
          const collapsed = collapsedIds.has(k.id);
          return (
            <div key={k.id}>
              <div
                className={`grid grid-cols-12 px-4 py-1.5 text-xs items-center hover:bg-surface-container-low/40 ${
                  k.depth === 2 ? "bg-surface-container-lowest/50" : "bg-surface-container-lowest/70"
                }`}
                style={{ paddingLeft: `${16 + indent * 24}px` }}
              >
                <div className="col-span-5 flex items-center gap-1.5 min-w-0">
                  {hasKids ? (
                    <button
                      onClick={() => toggle(k.id)}
                      className="w-4 h-4 text-on-surface-variant hover:text-on-surface shrink-0 text-[10px] flex items-center justify-center bg-surface-container rounded border border-subtle"
                      aria-label={collapsed ? "Expand" : "Collapse"}
                    >
                      {collapsed ? "▸" : "▾"}
                    </button>
                  ) : (
                    <span className="w-4 shrink-0 text-on-surface-variant">└</span>
                  )}
                  {k.is_blocked && (
                    <span className="text-rose-400" title="Blocked">●</span>
                  )}
                  <span className="font-mono text-on-surface-variant text-[11px] shrink-0">
                    {k.wbs || `#${k.id}`}
                  </span>
                  <button
                    onClick={() => setEdit({ id: k.id, projectId: k.project_id })}
                    className="truncate text-on-surface hover:text-primary hover:underline text-left"
                    title="Edit (status, dates, assignee, comments)"
                  >
                    {k.title}
                  </button>
                  <button
                    onClick={() => setDrawer({ id: k.id, projectId: k.project_id })}
                    className="text-[10px] text-on-surface-variant hover:text-on-surface shrink-0"
                    title="Open advanced drawer (tags, blocked-by, attachments, custom fields)"
                  >
                    ⧉
                  </button>
                  <span className="text-[10px] text-on-surface-variant shrink-0">
                    {k.depth === 1 ? "Subtask" : "Microtask"}
                  </span>
                </div>
                <div className="col-span-2 hidden md:block">
                    <span className="px-2 py-0.5 rounded bg-surface-container border border-subtle text-on-surface-variant text-[11px]">
                      {k.status_id != null
                        ? (statusById.get(k.status_id)?.name ?? `Status ${k.status_id}`)
                        : (stageById.get(k.stage_id ?? -1)?.name ?? `Stage ${k.stage_id}`)}
                    </span>
                </div>
                {isCategoryMode && (
                  <div className="col-span-2 hidden lg:block font-mono text-[11px] text-on-surface-variant truncate">
                    {projectById.get(k.project_id)?.code ?? `P${k.project_id}`}
                  </div>
                )}
                <div
                  className={`font-mono text-[11px] truncate ${
                    isCategoryMode ? "col-span-1" : "col-span-2"
                  } text-on-surface-variant`}
                >
                  {k.assignee_ids.length ? k.assignee_ids.map((a) => `U${a}`).join(", ") : "—"}
                </div>
                <div className="col-span-2 text-right font-mono text-[11px] text-on-surface-variant">
                  {k.due_date ?? "—"}
                </div>
              </div>
              {renderChildren(k.id, indent + 1)}
            </div>
          );
        })}
      </>
    );
  };

  return (
    <main className="p-6 bg-surface min-h-screen text-on-surface">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold">Status View</h1>
          <p className="text-xs text-on-surface-variant mt-0.5">
            {isCategoryMode ? "Category" : "Project"}: {scopeName} · {tasks.length} items · grouped by Status
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <button
            onClick={collapseAll}
            className="px-2.5 py-1.5 bg-surface-container hover:bg-surface-container-high rounded border border-subtle font-medium"
          >
            Collapse All (Tasks only)
          </button>
          <button
            onClick={expandAll}
            className="px-2.5 py-1.5 bg-surface-container hover:bg-surface-container-high rounded border border-subtle font-medium"
          >
            Expand All
          </button>
        </div>
      </div>

      {loading && (
        <div role="status" className="text-xs text-on-surface-variant">Loading status view…</div>
      )}
      {error && (
        <div role="alert" className="text-xs text-error">{error}</div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
        <div className="xl:col-span-9 space-y-4">
          {groups.map((g) => (
            <section key={g.key} className="bg-surface-container-low border border-subtle rounded overflow-hidden">
              <header className="px-4 py-2 border-b border-subtle text-sm font-semibold flex justify-between items-center">
                <span>{g.statusName}</span>
                <span className="text-on-surface-variant font-mono text-xs">
                  {g.rows.length} tasks
                </span>
              </header>
              <div className="grid grid-cols-12 px-4 py-2 text-[11px] font-semibold text-on-surface-variant border-b border-subtle bg-surface-container-lowest">
                <div className="col-span-5">Task (WBS · Title)</div>
                <div className="col-span-2 hidden md:block">Own Status</div>
                {isCategoryMode && <div className="col-span-2 hidden lg:block">Parent Project</div>}
                <div className={isCategoryMode ? "col-span-1" : "col-span-2"}>Assignees</div>
                <div className="col-span-2 text-right">Due</div>
              </div>
              <div className="divide-y divide-border-subtle">
                {g.rows.map((t) => {
                  const kids = childrenMap.get(t.id) ?? [];
                  const collapsed = collapsedIds.has(t.id);
                  return (
                    <div key={t.id}>
                      <div className="grid grid-cols-12 px-4 py-2.5 text-sm items-center hover:bg-surface-container-low/40">
                        <div className="col-span-5 flex items-center gap-1.5 min-w-0">
                          {kids.length > 0 ? (
                            <button
                              onClick={() => toggle(t.id)}
                              className="w-4 h-4 text-on-surface-variant hover:text-on-surface shrink-0 text-[10px] flex items-center justify-center bg-surface-container rounded border border-subtle"
                              aria-label={collapsed ? "Expand subtasks" : "Collapse subtasks"}
                            >
                              {collapsed ? "▸" : "▾"}
                            </button>
                          ) : (
                            <span className="w-4 shrink-0" />
                          )}
                          {t.is_blocked && (
                            <span className="text-rose-400" title="Blocked">●</span>
                          )}
                          <span className="font-mono text-on-surface-variant text-xs shrink-0">
                            {t.wbs || `#${t.id}`}
                          </span>
                          <button
                            onClick={() => setEdit({ id: t.id, projectId: t.project_id })}
                            className="truncate font-medium hover:text-primary hover:underline text-left"
                            title="Edit (status, dates, assignee, comments)"
                          >
                            {t.title}
                          </button>
                          <button
                            onClick={() => setDrawer({ id: t.id, projectId: t.project_id })}
                            className="text-[10px] text-on-surface-variant hover:text-on-surface shrink-0"
                            title="Open advanced drawer (tags, blocked-by, attachments, custom fields)"
                          >
                            ⧉
                          </button>
                          {kids.length > 0 && collapsed && (
                            <span className="ml-1 font-mono text-[10px] text-primary bg-primary-fixed/60 px-1.5 py-0.5 rounded border border-primary shrink-0">
                              +{kids.length}
                            </span>
                          )}
                        </div>
                        <div className="col-span-2 hidden md:block text-xs text-on-surface-variant">
                          {t.depth === 0 ? "Task" : t.depth === 1 ? "Subtask" : "Microtask"}
                        </div>
                        {isCategoryMode && (
                          <div className="col-span-2 hidden lg:block font-mono text-[11px] text-on-surface-variant truncate">
                            {projectById.get(t.project_id)?.code ?? `P${t.project_id}`}
                          </div>
                        )}
                        <div
                          className={`font-mono text-[11px] truncate text-on-surface-variant ${
                            isCategoryMode ? "col-span-1" : "col-span-2"
                          }`}
                        >
                          {t.assignee_ids.length ? t.assignee_ids.map((a) => `U${a}`).join(", ") : "—"}
                        </div>
                        <div className="col-span-2 text-right font-mono text-[11px] text-on-surface-variant">
                          {t.due_date ?? "—"}
                        </div>
                      </div>
                      {renderChildren(t.id, 1)}
                    </div>
                  );
                })}
                {g.rows.length === 0 && (
                  <div className="px-4 py-6 text-center text-outline text-sm">No tasks.</div>
                )}
              </div>
            </section>
          ))}
          {groups.length === 0 && !loading && (
            <div className="text-center text-outline text-sm py-10">
              No tasks match this {isCategoryMode ? "category" : "project"}.
            </div>
          )}
        </div>

        <div className="xl:col-span-3 space-y-4">
          <div className="bg-surface-container-lowest border border-subtle rounded p-4">
            <h2 className="text-sm font-semibold">Status Health</h2>
            <p className="text-[11px] text-on-surface-variant mb-2">
              Live counts over all {health.total} items (Tasks + Subtasks + Microtasks).
            </p>
            <ul className="space-y-1.5 text-xs">
              {statuses.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2">
                  <span className="truncate">{s.name}</span>
                  <span className="font-mono font-semibold">{health.counts.get(s.id) ?? 0}</span>
                </li>
              ))}
              {[...health.stageCounts.entries()].map(([sid, count]) => (
                <li key={`stage-${sid}`} className="flex items-center justify-between gap-2">
                  <span className="truncate">
                    {stageById.get(sid)?.name ?? `Stage ${sid}`} ●
                  </span>
                  <span className="font-mono font-semibold">{count}</span>
                </li>
              ))}
              {statuses.length === 0 && health.stageCounts.size === 0 && (
                <li className="text-on-surface-variant">No Status Profile linked.</li>
              )}
            </ul>
          </div>
          <div className="bg-surface-container-lowest border border-subtle rounded p-4">
            <h2 className="text-sm font-semibold">
              {isCategoryMode ? "Project Distribution" : "Depth Breakdown"}
            </h2>
            <p className="text-[11px] text-on-surface-variant mb-2">
              {isCategoryMode
                ? "Task concentration across this Category's Projects (all depths)."
                : "Items by hierarchy level in this Project."}
            </p>
            {isCategoryMode ? (
              <ul className="space-y-1.5 text-xs">
                {projectDist.map(([pid, count]) => (
                  <li key={pid} className="flex items-center justify-between gap-2">
                    <span className="truncate font-mono">
                      {projectById.get(pid)?.code ?? `P${pid}`}
                    </span>
                    <span className="font-mono font-semibold">{count}</span>
                  </li>
                ))}
                {projectDist.length === 0 && (
                  <li className="text-on-surface-variant">No tasks yet.</li>
                )}
              </ul>
            ) : (
              <ul className="space-y-1.5 text-xs">
                {depthDist.map((d) => (
                  <li key={d.label} className="flex items-center justify-between gap-2">
                    <span>{d.label}</span>
                    <span className="font-mono font-semibold">{d.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
      {drawer && (
        <TaskDrawer
          taskId={drawer.id}
          projectId={drawer.projectId}
          onClose={() => setDrawer(null)}
          onUpdated={() => setRefreshKey((k) => k + 1)}
        />
      )}
      {edit && (
        <TaskDialog
          projectId={edit.projectId}
          mode="edit"
          taskId={edit.id}
          onClose={() => setEdit(null)}
          onUpdated={() => setRefreshKey((k) => k + 1)}
        />
      )}
    </main>
  );
}
