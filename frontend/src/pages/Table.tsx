import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import TaskFilters, { EMPTY_FILTERS, buildTaskQuery, type TaskFilterState } from "../components/TaskFilters";
import TelemetryBar from "../components/TelemetryBar";
import { useAuth } from "../stores/auth";

interface FieldDef {
  id: number;
  key: string;
  label: string;
  type: string;
}

interface TableRow {
  id: number;
  title: string;
  status_id: number;
  status_name: string;
  start_date: string;
  due_date?: string | null;
  assignee_ids: number[];
  is_blocked: boolean;
  custom_fields: Record<string, string>;
}

export default function Table() {
  const auth = useAuth();
  const { id } = useParams();
  const [rows, setRows] = useState<TableRow[]>([]);
  const [defs, setDefs] = useState<FieldDef[]>([]);
  const [statuses, setStatuses] = useState<{ id: number; name: string }[]>([]);
  const [filters, setFilters] = useState<TaskFilterState>({ ...EMPTY_FILTERS });
  const [loading, setLoading] = useState(false);
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
    setLoading(true);
    const q = buildTaskQuery(id, filters);
    fetch(`/api/v1/tasks/table?${q}`, { headers: { Authorization: `Bearer ${auth.accessToken}` } })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Table failed: ${r.status}`))))
      .then((body) => {
        setDefs(body.defs ?? []);
        setRows(body.rows ?? []);
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  }, [auth.accessToken, id, filters]);

  return (
    <main className="p-6 bg-slate-950 min-h-screen text-slate-100 overflow-x-auto">
      <h1 className="text-xl font-semibold mb-1">Table</h1>
      <p className="text-xs text-slate-400 mb-4">Task, Status + dates, start, assignees and custom-field columns.</p>
      <TaskFilters filters={filters} onChange={setFilters} statuses={statuses} />
      {loading && <div role="status" className="mt-3 text-xs text-slate-400">Loading table…</div>}
      {error && <div role="alert" className="mt-3 text-xs text-rose-300">{error}</div>}
      <table className="mt-4 w-full text-xs border border-slate-800 rounded overflow-hidden">
        <thead>
          <tr className="bg-slate-900 text-slate-400 text-left">
            <th className="px-3 py-2 border-b border-slate-800">Task</th>
            <th className="px-3 py-2 border-b border-slate-800">Status</th>
            <th className="px-3 py-2 border-b border-slate-800">Start</th>
            <th className="px-3 py-2 border-b border-slate-800">Due</th>
            <th className="px-3 py-2 border-b border-slate-800">Assignees</th>
            {defs.map((d) => (
              <th key={d.id} className="px-3 py-2 border-b border-slate-800">
                {d.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800/60">
          {rows.map((r) => (
            <tr key={r.id} className="hover:bg-slate-900/60">
              <td className="px-3 py-2 text-slate-200">
                {r.is_blocked && <span className="text-rose-400 mr-1">●</span>}
                <span className="font-mono text-slate-500 mr-2">#{r.id}</span>
                {r.title}
              </td>
              <td className="px-3 py-2">
                <span className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-300">
                  {r.status_name || r.status_id}
                </span>
              </td>
              <td className="px-3 py-2 font-mono text-slate-400">{r.start_date}</td>
              <td className="px-3 py-2 font-mono text-slate-400">{r.due_date ?? "—"}</td>
              <td className="px-3 py-2 font-mono text-slate-400">
                {r.assignee_ids.length ? r.assignee_ids.join(", ") : "—"}
              </td>
              {defs.map((d) => (
                <td key={d.id} className="px-3 py-2 text-slate-300">
                  {r.custom_fields[d.key] || "—"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && !error && !loading && (
        <div className="text-center text-slate-500 text-sm py-10">No tasks match the current filters.</div>
      )}
      <div className="mt-4 border-t border-slate-800 pt-2">{id && <TelemetryBar projectId={id} />}</div>
    </main>
  );
}
