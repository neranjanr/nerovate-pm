import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import TaskFilters, { EMPTY_FILTERS, buildTaskQuery, type TaskFilterState } from "../components/TaskFilters";
import { useAuth } from "../stores/auth";

interface CalEvent {
  task_id: number;
  title: string;
  date: string;
  kind: string;
  status_id: number;
  status_name: string;
  depth: number;
  assignee_ids: number[];
}

interface StatusInfo {
  id: number;
  name: string;
}

export default function Calendar() {
  const auth = useAuth();
  const { id } = useParams();
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [statuses, setStatuses] = useState<StatusInfo[]>([]);
  const [filters, setFilters] = useState<TaskFilterState>({ ...EMPTY_FILTERS });
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
    fetch(`/api/v1/tasks/calendar?${q}`, { headers: { Authorization: `Bearer ${auth.accessToken}` } })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Calendar failed: ${r.status}`))))
      .then(setEvents)
      .catch((e) => setError(e.message));
  }, [auth.accessToken, id, filters]);

  const byDate = useMemo(() => {
    const m = new Map<string, CalEvent[]>();
    for (const e of events) m.set(e.date, [...(m.get(e.date) ?? []), e]);
    return [...m.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
  }, [events]);

  return (
    <main className="p-6 bg-slate-950 min-h-screen text-slate-100">
      <h1 className="text-xl font-semibold mb-1">Calendar</h1>
      <p className="text-xs text-slate-400 mb-4">Task dues + Status planned dues from the same filters as List.</p>
      <TaskFilters filters={filters} onChange={setFilters} statuses={statuses} />
      {error && <div className="mt-3 text-xs text-rose-300">{error}</div>}
      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {byDate.map(([d, evts]) => (
          <section key={d} className="bg-slate-900/40 border border-slate-800 rounded">
            <header className="px-3 py-2 border-b border-slate-800 font-mono text-xs text-indigo-300">{d}</header>
            <ul className="divide-y divide-slate-800/60">
              {evts.map((e, i) => (
                <li key={`${e.task_id}-${e.kind}-${i}`} className="px-3 py-2 text-xs">
                  <span
                    className={`inline-block px-1.5 py-0.5 rounded mr-2 font-semibold ${
                      e.kind === "task_due" ? "bg-indigo-950 text-indigo-300" : "bg-amber-950 text-amber-300"
                    }`}
                  >
                    {e.kind === "task_due" ? "Task due" : "Period due"}
                  </span>
                  <span className="text-slate-200">{e.title}</span>
                  <span className="text-slate-500 font-mono ml-2">#{e.task_id} · {e.status_name}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      {events.length === 0 && !error && (
        <div className="text-center text-slate-500 text-sm py-10">No due dates match the current filters.</div>
      )}
    </main>
  );
}
