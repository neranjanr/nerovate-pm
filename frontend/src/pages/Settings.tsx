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

  const canManage = auth.role === "admin" || auth.role === "manager";

  const fetchAll = () => {
    if (!auth.accessToken || !id) return;
    fetch(`/api/v1/projects/${id}/members`, { headers: { Authorization: `Bearer ${auth.accessToken}` } })
      .then((r) => (r.ok ? r.json() : []))
      .then(setMembers)
      .catch(() => setMembers([]));
    fetch(`/api/v1/status-profiles`, { headers: { Authorization: `Bearer ${auth.accessToken}` } })
      .then((r) => (r.ok ? r.json() : []))
      .then((all) => setTemplates((all as { id: number; name: string }[]).map((t) => ({ id: t.id, name: t.name }))))
      .catch(() => setTemplates([]));
  };

  useEffect(() => {
    fetchAll();
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

  const applyTemplate = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setNotice("");
    fetch(`/api/v1/projects/${id}/apply-profile/${templateId}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${auth.accessToken}` },
    })
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || "Apply template failed");
        return r.json();
      })
      .then(() => setNotice("Template applied (Statuses + Field Defs copied)."))
      .catch((err) => setError(err.message));
  };

  return (
    <main className="p-6 bg-slate-950 min-h-screen text-slate-100 max-w-3xl">
      <h1 className="text-xl font-semibold mb-1">Settings</h1>
      <p className="text-xs text-slate-400 mb-4">Members + template apply. Visible to manager/admin only.</p>
      {!canManage && <div className="text-sm text-amber-300">Your role ({auth.role}) is read-only here.</div>}
      {error && <div className="mt-3 text-xs text-rose-300">{error}</div>}
      {notice && <div className="mt-3 text-xs text-emerald-300">{notice}</div>}

      <section className="mt-4 bg-slate-900/40 border border-slate-800 rounded">
        <header className="px-4 py-2 border-b border-slate-800 text-sm font-semibold">Members ({members.length})</header>
        <ul className="divide-y divide-slate-800/60">
          {members.map((m) => (
            <li key={m.user_id} className="px-4 py-2 text-sm flex items-center justify-between">
              <span className="font-mono text-slate-300">
                User #{m.user_id} <span className="text-slate-500">· {m.role}</span>
              </span>
              {canManage && (
                <button
                  onClick={() => removeMember(m.user_id)}
                  className="px-2 py-1 text-xs rounded bg-rose-950 border border-rose-900 text-rose-300 hover:bg-rose-900"
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
        {canManage && (
          <form onSubmit={addMember} className="p-4 flex flex-wrap gap-2 border-t border-slate-800">
            <input
              aria-label="user id"
              placeholder="User id"
              inputMode="numeric"
              required
              className="px-2.5 py-1.5 rounded bg-slate-800 border border-slate-700 text-sm w-28"
              value={newUserId}
              onChange={(e) => setNewUserId(e.target.value.replace(/[^0-9]/g, ""))}
            />
            <select
              aria-label="member role"
              className="px-2 py-1.5 rounded bg-slate-800 border border-slate-700 text-sm"
              value={newRole}
              onChange={(e) => setNewRole(e.target.value)}
            >
              <option value="manager">manager</option>
              <option value="member">member</option>
              <option value="guest">guest</option>
            </select>
            <button type="submit" className="px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium">
              Add / Update member
            </button>
          </form>
        )}
      </section>

      <section className="mt-4 bg-slate-900/40 border border-slate-800 rounded">
        <header className="px-4 py-2 border-b border-slate-800 text-sm font-semibold">Apply template</header>
        {canManage ? (
          <form onSubmit={applyTemplate} className="p-4 flex flex-wrap gap-2">
            <select
              aria-label="template"
              required
              className="px-2 py-1.5 rounded bg-slate-800 border border-slate-700 text-sm min-w-52"
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
            >
              <option value="">Select Status Profile...</option>
              {templates.map((t) => (
                <option key={t.id} value={String(t.id)}>
                  #{t.id} {t.name}
                </option>
              ))}
            </select>
            <button type="submit" className="px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium">
              Apply to project
            </button>
          </form>
        ) : (
          <div className="p-4 text-xs text-slate-500">Manager or admin only.</div>
        )}
      </section>
    </main>
  );
}
