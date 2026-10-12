import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useAuth } from "../stores/auth";

interface Member {
  project_id: number;
  user_id: number;
  role: string;
}

interface Template {
  id: number;
  name: string;
  statuses?: { id: number; name: string }[];
}

export default function Settings() {
  const auth = useAuth();
  const { id } = useParams();
  const [members, setMembers] = useState<Member[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [newUserId, setNewUserId] = useState("");
  const [newRole, setNewRole] = useState("member");
  const [templateId, setTemplateId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [projName, setProjName] = useState("");
  const [projCode, setProjCode] = useState("");
  const [projColor, setProjColor] = useState("#6b7280");
  const [projStart, setProjStart] = useState("");
  const [projTarget, setProjTarget] = useState("");
  const [projStatus, setProjStatus] = useState("Active");
  const PROJECT_STATUSES = ["Not Started", "Active", "Complete"];
  const PROJECT_COLORS = ["#6b7280","#3b82f6","#10b981","#f59e0b","#ef4444","#8b5cf6","#ec4899","#06b6d4"];

  const canManage = auth.role === "admin" || auth.role === "manager";

  const fetchProject = () => {
    if (!auth.accessToken || !id) return;
    fetch(`/api/v1/projects/${id}`, { headers: { Authorization: `Bearer ${auth.accessToken}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((p) => {
        if (!p) return;
        setProjName(p.name || "");
        setProjCode(p.code || "");
        setProjColor(p.color || "#6b7280");
        setProjStart(p.start_date || "");
        setProjTarget(p.target_date || "");
        setProjStatus(p.project_status || "Active");
      })
      .catch(() => {});
  };

  const fetchAll = () => {
    if (!auth.accessToken || !id) return;
    fetch(`/api/v1/projects/${id}/members`, { headers: { Authorization: `Bearer ${auth.accessToken}` } })
      .then((r) => (r.ok ? r.json() : []))
      .then(setMembers)
      .catch(() => setMembers([]));
    fetch(`/api/v1/status-profiles`, { headers: { Authorization: `Bearer ${auth.accessToken}` } })
      .then((r) => (r.ok ? r.json() : []))
      .then((all) => setTemplates(all))
      .catch(() => setTemplates([]));
  };

  useEffect(() => {
    fetchAll();
    fetchProject();
  }, [auth.accessToken, id]);

  const addMember = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setNotice("");
    fetch(`/api/v1/projects/${id}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth.accessToken}` },
      body: JSON.stringify({ user_id: Number(newUserId), role: newRole }),
    })
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || "Add member failed");
        return r.json();
      })
      .then(() => {
        setNewUserId("");
        setNotice("Member saved.");
        fetchAll();
      })
      .catch((err) => setError(err.message));
  };

  const removeMember = (userId: number) => {
    setError("");
    setNotice("");
    fetch(`/api/v1/projects/${id}/members/${userId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${auth.accessToken}` },
    })
      .then(async (r) => {
        if (!r.ok && r.status !== 204) throw new Error((await r.json().catch(() => ({}))).detail || "Remove failed");
      })
      .then(() => {
        setNotice("Member removed.");
        fetchAll();
      })
      .catch((err) => setError(err.message));
  };

  const saveProject = (e: React.FormEvent) => {
    e.preventDefault();
    if (!id) return;
    setError("");
    setNotice("");
    fetch(`/api/v1/projects/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth.accessToken}` },
      body: JSON.stringify({
        name: projName.trim(),
        code: projCode.trim().toUpperCase(),
        color: projColor,
        start_date: projStart || null,
        target_date: projTarget || null,
        project_status: projStatus,
      }),
    })
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || "Save failed");
        return r.json();
      })
      .then((p) => {
        setProjName(p.name || "");
        setProjCode(p.code || "");
        setProjColor(p.color || "#6b7280");
        setProjStatus(p.project_status || "Active");
        setNotice(`Project saved — Status: ${p.project_status || "Active"} (independent of task statuses).`);
      })
      .catch((err) => setError(err.message));
  };

  const applyProfile = (e: React.FormEvent) => {
    e.preventDefault();
    if (!templateId) return;
    setError("");
    setNotice("");
    fetch(`/api/v1/projects/${id}/apply-profile/${templateId}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${auth.accessToken}` },
    })
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || "Apply profile failed");
        return r.json();
      })
      .then(() => {
        setNotice("Status Profile applied successfully. Orphaned statuses mapped.");
      })
      .catch((err) => setError(err.message));
  };

  return (
    <main className="p-6 bg-surface min-h-screen text-on-surface max-w-4xl">
      <h1 className="text-xl font-semibold mb-1">Project Settings</h1>
      <p className="text-xs text-on-surface-variant mb-4">Manage project members and select Status Profile. Manager/admin only.</p>

      {!canManage && <div className="text-sm text-amber-300">Your role ({auth.role}) is read-only here.</div>}
      {error && <div className="mt-3 text-xs text-error">{error}</div>}
      {notice && <div className="mt-3 text-xs text-emerald-300">{notice}</div>}

      {/* Project fields + Project Status */}
      <section className="mt-4 bg-surface-container-lowest border border-subtle rounded-lg overflow-hidden">
        <header className="px-4 py-2.5 border-b border-subtle text-sm font-semibold">Project Details — incl. Project Status</header>
        {canManage ? (
          <form onSubmit={saveProject} className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-on-surface-variant mb-1">Name *</label>
              <input
                required
                aria-label="project name"
                className="w-full px-3 py-2 rounded bg-surface-container border border-subtle text-sm"
                value={projName}
                onChange={(e) => setProjName(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs text-on-surface-variant mb-1">Code * (unique within Category)</label>
              <input
                required
                aria-label="project code"
                className="w-full px-3 py-2 rounded bg-surface-container border border-subtle text-sm uppercase"
                value={projCode}
                onChange={(e) => setProjCode(e.target.value.toUpperCase())}
              />
            </div>
            <div>
              <label className="block text-xs text-on-surface-variant mb-1">Start date</label>
              <input
                type="date"
                aria-label="start date"
                className="w-full px-3 py-2 rounded bg-surface-container border border-subtle text-sm"
                value={projStart}
                onChange={(e) => setProjStart(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs text-on-surface-variant mb-1">Target date</label>
              <input
                type="date"
                aria-label="target date"
                className="w-full px-3 py-2 rounded bg-surface-container border border-subtle text-sm"
                value={projTarget}
                onChange={(e) => setProjTarget(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs text-on-surface-variant mb-1">Project Status (manual, independent of tasks)</label>
              <select
                aria-label="project status"
                className="w-full px-3 py-2 rounded bg-surface-container border border-subtle text-sm"
                value={projStatus}
                onChange={(e) => setProjStatus(e.target.value)}
              >
                {PROJECT_STATUSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-on-surface-variant mb-1">Display color</label>
              <div className="flex flex-wrap gap-1.5">
                {PROJECT_COLORS.map((c) => (
                  <button key={c} type="button" onClick={() => setProjColor(c)} className={`w-6 h-6 rounded border ${projColor === c ? "ring-2 ring-primary ring-offset-2 ring-offset-surface" : "border-subtle"}`} style={{ backgroundColor: c }} title={c} />
                ))}
              </div>
              <div className="flex items-center gap-2 mt-1.5">
                <input type="color" aria-label="project color" className="w-8 h-8" value={projColor} onChange={(e) => setProjColor(e.target.value.toLowerCase())} />
                <span className="font-mono text-xs text-on-surface-variant">{projColor}</span>
              </div>
            </div>
            <div className="sm:col-span-2">
              <button type="submit" className="px-4 py-2 rounded bg-primary-container hover:bg-primary text-on-primary text-sm font-medium">
                Save Project
              </button>
            </div>
          </form>
        ) : (
          <div className="p-4 text-xs text-outline">
            {projName} ({projCode}) — Status: {projStatus}
          </div>
        )}
      </section>

      {/* Members Section */}
      <section className="mt-4 bg-surface-container-lowest border border-subtle rounded-lg overflow-hidden">
        <header className="px-4 py-2.5 border-b border-subtle text-sm font-semibold">Project Members ({members.length})</header>
        <ul className="divide-y divide-border-subtle">
          {members.map((m) => (
            <li key={m.user_id} className="px-4 py-2 text-sm flex items-center justify-between">
              <span className="font-mono text-on-surface-variant">
                User #{m.user_id} <span className="text-outline">· {m.role}</span>
              </span>
              {canManage && (
                <button
                  onClick={() => removeMember(m.user_id)}
                  className="px-2 py-1 text-xs rounded bg-error-container border border-rose-900 text-error hover:bg-rose-900"
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
        {canManage && (
          <form onSubmit={addMember} className="p-4 flex flex-wrap gap-2 border-t border-subtle">
            <input
              aria-label="user id"
              placeholder="User id"
              inputMode="numeric"
              required
              className="px-2.5 py-1.5 rounded bg-surface-container border border-subtle text-sm w-28 text-on-surface"
              value={newUserId}
              onChange={(e) => setNewUserId(e.target.value.replace(/[^0-9]/g, ""))}
            />
            <select
              aria-label="member role"
              className="px-2 py-1.5 rounded bg-surface-container border border-subtle text-sm text-on-surface"
              value={newRole}
              onChange={(e) => setNewRole(e.target.value)}
            >
              <option value="manager">manager</option>
              <option value="member">member</option>
              <option value="guest">guest</option>
            </select>
            <button type="submit" className="px-3 py-1.5 rounded bg-primary-container hover:bg-primary text-on-primary text-sm font-medium">
              Add / Update member
            </button>
          </form>
        )}
      </section>

      {/* Status Profile Selection Section */}
      <section className="mt-6 bg-surface-container-lowest border border-subtle rounded-lg overflow-hidden">
        <header className="px-4 py-2.5 border-b border-subtle text-sm font-semibold">Select Status Profile</header>
        {canManage ? (
          <form onSubmit={applyProfile} className="p-4 flex flex-wrap gap-3 items-center">
            <select
              aria-label="Status profile"
              required
              className="px-3 py-2 rounded bg-surface-container border border-subtle text-sm min-w-64 text-on-surface"
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
            >
              <option value="">Select global Status Profile...</option>
              {templates.map((t) => (
                <option key={t.id} value={String(t.id)}>
                  #{t.id} {t.name} ({t.statuses?.length ?? 0} statuses)
                </option>
              ))}
            </select>
            <button type="submit" className="px-4 py-2 rounded bg-primary-container hover:bg-primary text-on-primary text-sm font-medium">
              Apply Profile & Map Statuses
            </button>
          </form>
        ) : (
          <div className="p-4 text-xs text-outline">Manager or admin only.</div>
        )}
      </section>
    </main>
  );
}
