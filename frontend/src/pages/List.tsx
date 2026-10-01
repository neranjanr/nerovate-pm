import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import TaskFilters, { EMPTY_FILTERS, buildTaskQuery, type TaskFilterState } from "../components/TaskFilters";
import { useAuth } from "../stores/auth";

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
}

export default function List() {
  const auth = useAuth();
  const { id } = useParams();
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [statuses, setStatuses] = useState<StatusInfo[]>([]);
  const [filters, setFilters] = useState<TaskFilterState>({ ...EMPTY_FILTERS });
  const [groupBy, setGroupBy] = useState<"status" | "assignee" | "none">("status");
  const [error, setError] = useState("");

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

  useEffect(() => {
    if (!auth.accessToken || !id) return;
    const q = buildTaskQuery(id, filters);
    fetch(`/api/v1/tasks?${q}`, { headers: { Authorization: `Bearer ${auth.accessToken}` } })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`List failed: ${r.status}`))))
      .then(setTasks)
      .catch((e) => setError(e.message));
  }, [auth.accessToken, id, filters]);

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

  return (
    <main className="p-6 bg-slate-950 min-h-screen text-slate-100">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">List</h1>
        <div className="flex items-center gap-1 text-xs bg-slate-800 rounded p-1 border border-slate-700">
          {(["status", "assignee", "none"] as const).map((g) => (
            <button
              key={g}
              onClick={() => setGroupBy(g)}
              className={`px-2.5 py-1 rounded capitalize ${groupBy === g ? "bg-indigo-600 text-white" : "text-slate-300"}`}
            >
              {g === "none" ? "No grouping" : `By ${g}`}
            </button>
          ))}
        </div>
      </div>
      <TaskFilters filters={filters} onChange={setFilters} statuses={statuses} />
      {error && <div className="mt-3 text-xs text-rose-300">{error}</div>}
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
                  <span className="text-xs text-slate-400 font-mono shrink-0">
                    depth {t.depth} · {t.due_date ?? "no due"}
                  </span>
                </li>
              ))}
              {rows.length === 0 && <li className="px-4 py-6 text-center text-slate-500 text-sm">No tasks.</li>}
            </ul>
          </section>
        ))}
        {tasks.length === 0 && <div className="text-center text-slate-500 text-sm py-10">No tasks match the current filters.</div>}
      </div>
    </main>
  );
}
