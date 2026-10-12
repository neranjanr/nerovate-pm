import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../stores/auth";

interface ProjectLink {
  id: number;
  from_project_id: number;
  to_project_id: number;
  kind: string;
  note: string;
  to_project_name?: string | null;
  to_project_code?: string | null;
  to_category_id?: number | null;
  to_category_name?: string | null;
}

interface ProjectOption {
  id: number;
  code: string;
  name: string;
  category_id?: number | null;
  category_name?: string | null;
}

/**
 * Project header `Linked projects` chips (SPEC-v0.3 4.5 / U6, ADR-0006).
 * Plain links only: cross-Category jump, no rollup, no cross-Project blocking.
 */
export default function LinkedProjects({ projectId }: { projectId: string }) {
  const auth = useAuth();
  const navigate = useNavigate();
  const [links, setLinks] = useState<ProjectLink[]>([]);
  const [options, setOptions] = useState<ProjectOption[]>([]);
  const [toId, setToId] = useState("");
  const [kind, setKind] = useState("relates-to");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [forbidden, setForbidden] = useState(false);

  const fetchLinks = useCallback(() => {
    if (!auth.accessToken || !projectId) return;
    fetch(`/api/v1/projects/${projectId}/links`, {
      headers: { Authorization: `Bearer ${auth.accessToken}` },
    })
      .then((r) => {
        if (r.status === 404) {
          // Non-member (no enumeration): hide the strip entirely.
          setForbidden(true);
          return [];
        }
        setForbidden(false);
        return r.ok ? r.json() : [];
      })
      .then((r) => (r.ok ? r.json() : []))
      .then(setLinks)
      .catch(() => setLinks([]));
  }, [auth.accessToken, projectId]);

  useEffect(() => {
    fetchLinks();
  }, [fetchLinks]);

  useEffect(() => {
    if (!auth.accessToken || !showForm) return;
    fetch("/api/v1/projects", {
      headers: { Authorization: `Bearer ${auth.accessToken}` },
    })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: ProjectOption[]) =>
        setOptions(rows.filter((p) => String(p.id) !== String(projectId)))
      )
      .catch(() => setOptions([]));
  }, [auth.accessToken, showForm, projectId]);

  const canWrite = auth.role !== "guest";

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!toId) {
      setError("Pick a target project.");
      return;
    }
    fetch(`/api/v1/projects/${projectId}/links`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth.accessToken}`,
      },
      body: JSON.stringify({ to_project_id: Number(toId), kind, note }),
    })
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body.detail || `Link failed: ${r.status}`);
        }
        return r.json();
      })
      .then(() => {
        setToId("");
        setNote("");
        setShowForm(false);
        fetchLinks();
      })
      .catch((err) => setError(err.message));
  };

  const handleDelete = (linkId: number) => {
    fetch(`/api/v1/projects/${projectId}/links/${linkId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${auth.accessToken}` },
    }).then(() => fetchLinks());
  };

  if (forbidden) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs" aria-label="Linked projects">
      <span className="text-on-surface-variant font-medium">Linked projects:</span>
      {links.map((l) => (
        <span
          key={l.id}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface-container border border-subtle text-on-surface"
          title={l.note || l.kind}
        >
          <button
            onClick={() => navigate(`/projects/${l.to_project_id}/timeline`)}
            className="hover:text-primary font-medium"
            title={`Jump to ${l.to_category_name || "Category"} / ${l.to_project_name || l.to_project_id}`}
          >
            {(l.to_category_name || "—") + " / " + (l.to_project_name || `#${l.to_project_id}`)}
          </button>
          <span className="px-1.5 py-0.5 rounded bg-primary-fixed text-primary font-mono text-[10px]">
            {l.kind}
          </span>
          {canWrite && (
            <button
              onClick={() => handleDelete(l.id)}
              className="text-outline hover:text-error ml-0.5"
              title="Remove link"
              aria-label={`Remove link to ${l.to_project_name}`}
            >
              ✕
            </button>
          )}
        </span>
      ))}
      {links.length === 0 && (
        <span className="text-outline italic">No links yet.</span>
      )}
      {canWrite && !showForm && (
        <button
          onClick={() => setShowForm(true)}
          className="px-2 py-1 rounded bg-surface-container hover:bg-surface-container-high border border-subtle text-on-surface-variant font-medium"
        >
          +Link project
        </button>
      )}
      {canWrite && showForm && (
        <form onSubmit={handleAdd} className="flex items-center gap-1.5">
          <select
            aria-label="target project"
            value={toId}
            onChange={(e) => setToId(e.target.value)}
            className="px-2 py-1 rounded bg-surface-container border border-subtle text-on-surface text-xs max-w-56"
          >
            <option value="">Select project…</option>
            {options.map((p) => (
              <option key={p.id} value={p.id}>
                {(p.category_name || `Cat ${p.category_id ?? "?"}`) + " / " + p.name}
              </option>
            ))}
          </select>
          <select
            aria-label="link kind"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            className="px-2 py-1 rounded bg-surface-container border border-subtle text-on-surface text-xs"
          >
            <option value="relates-to">relates-to</option>
            <option value="continues-as">continues-as</option>
          </select>
          <input
            aria-label="link note"
            placeholder="Note (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={2000}
            className="px-2 py-1 rounded bg-surface-container border border-subtle text-on-surface text-xs w-36"
          />
          <button
            type="submit"
            className="px-2 py-1 rounded bg-primary-container hover:bg-primary text-on-primary font-medium"
          >
            Add
          </button>
          <button
            type="button"
            onClick={() => setShowForm(false)}
            className="px-2 py-1 rounded text-on-surface-variant hover:text-on-surface"
          >
            Cancel
          </button>
          {error && <span role="alert" className="text-error">{error}</span>}
        </form>
      )}
    </div>
  );
}
