import { useEffect, useState } from "react";
import { useAuth } from "../stores/auth";

interface TaskDefaults {
  project_id: number;
  status_id: number | null;
  status_name: string | null;
  stage_id: number | null;
  stage_name: string | null;
  start_date: string;
}

interface TaskCreateModalProps {
  projectId: string | number;
  parentId?: number | null;
  parentTitle?: string | null;
  /** Depth label: Task / Subtask / Microtask */
  kind?: "Task" | "Subtask" | "Microtask";
  onClose: () => void;
  onCreated: () => void;
}

/**
 * U4 title-only create modal. POSTs {project_id, parent_id?, title} only;
 * server defaults status_id (first leaf of first Stage) + start_date (today).
 * Shows those defaults as hints via GET /tasks/defaults.
 */
export default function TaskCreateModal({
  projectId,
  parentId = null,
  parentTitle = null,
  kind = "Task",
  onClose,
  onCreated,
}: TaskCreateModalProps) {
  const auth = useAuth();
  const [title, setTitle] = useState("");
  const [defaults, setDefaults] = useState<TaskDefaults | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!auth.accessToken || !projectId) return;
    fetch(`/api/v1/tasks/defaults?project_id=${projectId}`, {
      headers: { Authorization: `Bearer ${auth.accessToken}` },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then(setDefaults)
      .catch(() => setDefaults(null));
  }, [auth.accessToken, projectId]);

  const submit = async () => {
    if (!auth.accessToken) return;
    const t = title.trim();
    if (!t) {
      setError("Title required");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const body: Record<string, unknown> = { project_id: Number(projectId), title: t };
      if (parentId != null) body.parent_id = parentId;
      const r = await fetch("/api/v1/tasks", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth.accessToken}`,
        },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(`Create failed: ${r.status}`);
      onCreated();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed");
    } finally {
      setSaving(false);
    }
  };

  const label = parentId != null ? (kind === "Microtask" ? "+Add Microtask" : "+Add Subtask") : "+Add Task";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-lg border border-slate-700 bg-slate-900 p-4">
        <h2 className="text-sm font-semibold text-slate-100">{label}</h2>
        {parentTitle && (
          <p className="mt-1 text-xs text-slate-400">
            Under: <span className="text-slate-200">{parentTitle}</span>
          </p>
        )}
        <label className="mt-3 block text-xs text-slate-400">
          Title
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
              if (e.key === "Escape") onClose();
            }}
            placeholder={`${kind} title`}
            className="mt-1 w-full rounded border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-sm text-slate-100"
          />
        </label>
        <p className="mt-2 text-[11px] text-slate-500">
          Defaults: Status {defaults?.status_name ?? "…"}
          {defaults?.stage_name ? ` (${defaults.stage_name})` : ""} · Start {defaults?.start_date ?? "today"}
        </p>
        {error && (
          <div role="alert" className="mt-2 text-xs text-rose-300">
            {error}
          </div>
        )}
        <div className="mt-3 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded border border-slate-700 bg-slate-800 text-xs text-slate-300 hover:bg-slate-700"
          >
            Cancel
          </button>
          <button
            onClick={() => void submit()}
            disabled={saving}
            className="px-3 py-1.5 rounded bg-indigo-600 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {saving ? "Saving…" : label}
          </button>
        </div>
      </div>
    </div>
  );
}
