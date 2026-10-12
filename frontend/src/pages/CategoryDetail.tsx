import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../stores/auth";
import { PROJECT_STATUSES } from "./Categories";

interface Category {
  id: number;
  key: string;
  name: string;
  color: string;
  status_profile_id?: number | null;
  profile_name?: string | null;
}

interface Proj {
  id: number;
  code: string;
  name: string;
  color?: string | null;
  start_date?: string | null;
  project_status?: string;
}

interface Member {
  category_id: number;
  user_id: number;
  role: string;
}

interface Stage {
  id: number;
  profile_id: number;
  name: string;
  order: number;
  color_base: string;
}

interface ProfileStatus {
  id: number;
  profile_id: number;
  stage_id?: number | null;
  name: string;
  color: string;
  shade?: string | null;
  order: number;
  is_done?: boolean;
}

interface Profile {
  id: number;
  name: string;
}

const COLORS = ["#6b7280","#3b82f6","#10b981","#f59e0b","#ef4444","#8b5cf6","#ec4899","#06b6d4"];

function statusColor(s?: string | null) {
  if (s === "Complete") return "#10b981";
  if (s === "Not Started") return "#6b7280";
  return "#3b82f6";
}

export default function CategoryDetail() {
  const auth = useAuth();
  const { id } = useParams();
  const [cat, setCat] = useState<Category | null>(null);
  const [projects, setProjects] = useState<Proj[]>([]);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState("#6b7280");
  const [projName, setProjName] = useState("");
  const [projCode, setProjCode] = useState("");
  const [projColor, setProjColor] = useState("#6b7280");
  const [error, setError] = useState("");
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [profileId, setProfileId] = useState("");
  const [stages, setStages] = useState<Stage[]>([]);
  const [profileStatuses, setProfileStatuses] = useState<ProfileStatus[]>([]);
  const [stageNotice, setStageNotice] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [memberUserId, setMemberUserId] = useState("");
  const canManage = auth.role === "admin" || auth.role === "manager";

  const fetchProfiles = () => {
    if (!auth.accessToken) return;
    fetch(`/api/v1/status-profiles`, {
      headers: { Authorization: `Bearer ${auth.accessToken}` },
    })
      .then((r) => (r.ok ? r.json() : []))
      .then((all) => setProfiles((all as { id: number; name: string }[]).map((p) => ({ id: p.id, name: p.name }))))
      .catch(() => setProfiles([]));
  };

  const fetchStages = (pid: number) => {
    if (!auth.accessToken) return;
    fetch(`/api/v1/status-profiles/${pid}/stages`, {
      headers: { Authorization: `Bearer ${auth.accessToken}` },
    })
      .then((r) => (r.ok ? r.json() : []))
      .then(setStages)
      .catch(() => setStages([]));
    fetch(`/api/v1/status-profiles/${pid}/statuses`, {
      headers: { Authorization: `Bearer ${auth.accessToken}` },
    })
      .then((r) => (r.ok ? r.json() : []))
      .then(setProfileStatuses)
      .catch(() => setProfileStatuses([]));
  };

  const fetchMembers = (cid: number) => {
    if (!auth.accessToken) return;
    fetch(`/api/v1/categories/${cid}/members`, {
      headers: { Authorization: `Bearer ${auth.accessToken}` },
    })
      .then((r) => (r.ok ? r.json() : []))
      .then(setMembers)
      .catch(() => setMembers([]));
  };

  const load = () => {
    if (!auth.accessToken || !id) return;
    fetch(`/api/v1/categories/${id}`, { headers: { Authorization: `Bearer ${auth.accessToken}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((c) => {
        if (c) {
          setCat(c);
          setName(c.name);
          setColor(c.color);
          setProfileId(c.status_profile_id ? String(c.status_profile_id) : "");
          setStageNotice("");
          if (c.status_profile_id) fetchStages(c.status_profile_id);
          else {
            setStages([]);
            setProfileStatuses([]);
          }
        }
      })
      .catch(() => {});
    fetch(`/api/v1/categories/${id}/projects`, { headers: { Authorization: `Bearer ${auth.accessToken}` } })
      .then((r) => (r.ok ? r.json() : []))
      .then(setProjects)
      .catch(() => setProjects([]));
    fetchProfiles();
    fetchMembers(Number(id));
  };

  useEffect(load, [auth.accessToken, id]);

  const saveSettings = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const trimmed = name.trim();
    if (!trimmed) { setError("Name required"); return; }
    if (trimmed.length > 80) { setError("Name max 80 chars"); return; }
    fetch(`/api/v1/categories/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth.accessToken}` },
      body: JSON.stringify({ name: trimmed, color }),
    })
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || "Save failed");
        return r.json();
      })
      .then((c) => { setCat(c); setShowSettings(false); })
      .catch((err) => setError(err.message));
  };

  const handleSetProfile = (e: React.FormEvent) => {
    e.preventDefault();
    if (!profileId || profileId === "__new__") return;
    setError("");
    setStageNotice("");
    fetch(`/api/v1/categories/${id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth.accessToken}`,
      },
      body: JSON.stringify({ status_profile_id: Number(profileId) }),
    })
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || "Failed to set profile");
        return r.json();
      })
      .then((updated: Category) => {
        setCat(updated);
        fetchStages(Number(profileId));
        fetchProfiles();
        setStageNotice("Profile linked (live reference — edits visible to all projects).");
      })
      .catch((err) => setError(err.message));
  };

  const addProject = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    fetch("/api/v1/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth.accessToken}` },
      body: JSON.stringify({ name: projName, code: projCode.trim() || undefined, color: projColor, category_id: Number(id) }),
    })
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || "Create failed");
        return r.json();
      })
      .then(() => { setProjName(""); setProjCode(""); setProjColor("#6b7280"); setShowAdd(false); load(); })
      .catch((err) => setError(err.message));
  };

  const handleAddMember = (e: React.FormEvent) => {
    e.preventDefault();
    if (!memberUserId) return;
    fetch(`/api/v1/categories/${id}/members`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth.accessToken}`,
      },
      body: JSON.stringify({ user_id: Number(memberUserId), role: "member" }),
    }).then(() => {
      setMemberUserId("");
      fetchMembers(Number(id));
    });
  };

  const visible = [...projects]
    .sort((a, b) => a.code.localeCompare(b.code))
    .filter((p) => {
      const ql = q.toLowerCase();
      const okText = !ql || p.name.toLowerCase().includes(ql) || p.code.toLowerCase().includes(ql);
      const okStatus = !statusFilter || (p.project_status || "Active") === statusFilter;
      return okText && okStatus;
    });

  if (!cat) return <main className="p-6 bg-surface min-h-screen text-on-surface">Loading…</main>;

  return (
    <main className="p-6 bg-surface min-h-screen text-on-surface">
      <div className="flex items-start justify-between gap-3 mb-4 max-w-4xl rounded-t" style={{ borderTop: `3px solid ${cat.color}` }}>
        <div className="pt-2">
          <div className="text-xs text-on-surface-variant mb-1">
            <Link to="/categories" className="underline">← Categories</Link>
            <span className="mx-1">/</span>
            <span className="inline-block w-2.5 h-2.5 rounded-full mr-1.5" style={{ backgroundColor: cat.color }} />
            <strong className="text-on-surface">{cat.name}</strong>
            <span className="ml-2 text-outline">({projects.length})</span>
          </div>
          <h1 className="text-2xl font-semibold">{cat.name}</h1>
          <p className="text-xs text-on-surface-variant">Key {cat.key} · ID {cat.id} (immutable)</p>
        </div>
        <div className="flex items-center gap-2 shrink-0 pt-2">
          <Link
            to={`/categories/${id}/kanban`}
            className="px-3 py-1.5 rounded border border-subtle text-xs hover:bg-surface-container-low"
            title="Kanban — Tasks by Stage/Status across this Category"
          >
            ▦ Kanban
          </Link>
          <Link
            to={`/categories/${id}/status`}
            className="px-3 py-1.5 rounded border border-subtle text-xs hover:bg-surface-container-low"
            title="Status View — Tasks by Status across this Category"
          >
            ◔ Status View
          </Link>
          <Link
            to={`/categories/${id}/mindmap`}
            className="px-3 py-1.5 rounded border border-subtle text-xs hover:bg-surface-container-low"
            title="Mind Map — Visual decomposition across this Category's Projects"
          >
            ♡ Mind Map
          </Link>
          {canManage && (
            <button onClick={() => setShowSettings(!showSettings)} className="px-3 py-1.5 rounded border border-subtle text-xs hover:bg-surface-container-low" title="Category Settings">
              ⚙ Settings
            </button>
          )}
          {canManage && (
            <button onClick={() => setShowAdd(!showAdd)} className="px-3 py-1.5 bg-primary-container hover:bg-primary rounded text-xs font-medium text-on-primary">
              {showAdd ? "Cancel" : "+ New Project"}
            </button>
          )}
        </div>
      </div>

      {error && <div className="mb-3 text-sm text-rose-400 max-w-4xl">{error}</div>}

      {showSettings && canManage && (
        <div className="mb-4 max-w-4xl space-y-4">
          <form onSubmit={saveSettings} className="rounded border border-subtle bg-surface-container-lowest p-4">
            <h2 className="text-sm font-semibold mb-2">Category Settings</h2>
            <p className="text-[11px] text-outline mb-2">ID {cat.id} · Key {cat.key} — read-only, rename preserves key.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-xs text-on-surface-variant mb-1">Name * (1-80, unique)</label>
                <input required maxLength={80} className="w-full px-3 py-2 rounded bg-surface-container text-sm border border-subtle" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs text-on-surface-variant mb-1">Tile color</label>
                <div className="flex flex-wrap gap-2">
                  {COLORS.map((c) => (
                    <button key={c} type="button" onClick={() => setColor(c)} className={`w-7 h-7 rounded border ${color === c ? "ring-2 ring-primary ring-offset-2 ring-offset-surface" : "border-subtle"}`} style={{ backgroundColor: c }} title={c} />
                  ))}
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <input type="color" aria-label="custom color" className="w-8 h-8" value={color} onChange={(e) => setColor(e.target.value.toLowerCase())} />
                  <span className="font-mono text-xs text-on-surface-variant">{color}</span>
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <button type="submit" className="px-4 py-2 bg-primary-container rounded text-sm text-on-primary">Save</button>
              <button type="button" onClick={() => setShowSettings(false)} className="px-4 py-2 rounded border border-subtle text-sm">Cancel</button>
            </div>
          </form>

          <div className="rounded border border-subtle bg-surface-container-low/60 p-3">
            <h3 className="text-sm font-semibold mb-2">Status Profile (live reference)</h3>
            {stageNotice && <div className="mb-2 text-xs text-emerald-300">{stageNotice}</div>}
            <form onSubmit={handleSetProfile} className="flex flex-wrap gap-2 mb-2">
              <select
                aria-label="status profile"
                className="flex-1 min-w-40 px-3 py-2 rounded bg-surface-container text-sm border border-subtle"
                value={profileId}
                onChange={(e) => {
                  if (e.target.value === "__new__") {
                    window.location.href = "/settings";
                  } else {
                    setProfileId(e.target.value);
                  }
                }}
              >
                <option value="">Select profile...</option>
                {profiles.map((p) => (
                  <option key={p.id} value={String(p.id)}>
                    #{p.id} {p.name}
                  </option>
                ))}
                <option value="__new__">+ (new) — create in Global Settings…</option>
              </select>
              <button type="submit" className="px-4 py-2 bg-primary-container hover:bg-primary rounded text-sm font-medium text-on-primary">
                Link profile
              </button>
            </form>
            <p className="text-[11px] text-outline mb-2">
              Edits happen in <Link to="/settings" className="underline text-primary">Global Settings › Status Profiles</Link> — live for all linked projects.
            </p>
            {profileId && (
              <div className="space-y-2">
                {stages.map((st) => (
                  <div key={st.id} className="rounded border border-subtle bg-surface-container-lowest px-3 py-2">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: st.color_base }} />
                      <strong>{st.name}</strong>
                    </div>
                    <ul className="mt-2 space-y-1">
                      {profileStatuses
                        .filter((s) => s.stage_id === st.id)
                        .map((s) => (
                          <li key={s.id} className="flex items-center bg-surface-container px-2.5 py-1 rounded text-xs">
                            <span
                              className="inline-block w-2.5 h-2.5 rounded-full mr-2"
                              style={{ backgroundColor: s.shade || s.color }}
                            />
                            {s.name}
                          </li>
                        ))}
                    </ul>
                  </div>
                ))}
                {stages.length === 0 && profileStatuses.length === 0 && (
                  <p className="text-xs text-outline">No stages/statuses yet — add them in Global Settings.</p>
                )}
              </div>
            )}
          </div>

          <div className="rounded border border-subtle bg-surface-container-lowest p-4">
            <h3 className="text-sm font-semibold mb-2">Members</h3>
            <ul className="text-sm text-on-surface-variant mb-3 space-y-1">
              {members.map((m) => (
                <li key={m.user_id} className="flex items-center justify-between bg-surface-container px-3 py-1.5 rounded">
                  <span>User #{m.user_id} ({m.role})</span>
                  <button
                    onClick={() => {
                      fetch(`/api/v1/categories/${id}/members/${m.user_id}`, {
                        method: "DELETE",
                        headers: { Authorization: `Bearer ${auth.accessToken}` },
                      }).then(() => fetchMembers(Number(id)));
                    }}
                    className="text-xs text-rose-400 hover:text-error"
                  >
                    Remove
                  </button>
                </li>
              ))}
              {members.length === 0 && <li className="text-outline">No members yet.</li>}
            </ul>
            <form onSubmit={handleAddMember} className="flex gap-2">
              <input
                aria-label="member user id"
                placeholder="User ID"
                className="w-32 px-3 py-2 rounded bg-surface-container text-sm border border-subtle"
                value={memberUserId}
                onChange={(e) => setMemberUserId(e.target.value)}
              />
              <button type="submit" className="px-4 py-2 bg-surface-container-high hover:bg-surface-container-highest rounded text-sm font-medium text-on-surface">
                Add member
              </button>
            </form>
          </div>
        </div>
      )}

      {showAdd && canManage && (
        <form onSubmit={addProject} className="flex flex-wrap items-end gap-2 mb-4 max-w-4xl">
          <input required placeholder="Project name" aria-label="project name" className="flex-1 min-w-40 px-3 py-2 rounded bg-surface-container text-sm border border-subtle" value={projName} onChange={(e) => setProjName(e.target.value)} />
          <input placeholder="Code (optional)" aria-label="project code" className="w-32 px-3 py-2 rounded bg-surface-container text-sm border border-subtle uppercase" value={projCode} onChange={(e) => setProjCode(e.target.value)} />
          <div className="flex items-center gap-2">
            <label className="text-xs text-on-surface-variant">Color</label>
            <div className="flex gap-1">
              {COLORS.map((c) => (
                <button key={c} type="button" onClick={() => setProjColor(c)} className={`w-6 h-6 rounded border ${projColor === c ? "ring-2 ring-primary ring-offset-2 ring-offset-surface" : "border-subtle"}`} style={{ backgroundColor: c }} title={c} />
              ))}
            </div>
            <input type="color" aria-label="project color" className="w-8 h-8" value={projColor} onChange={(e) => setProjColor(e.target.value.toLowerCase())} />
          </div>
          <button type="submit" className="px-4 py-2 bg-primary-container rounded text-sm text-on-primary">Create (defaults Active)</button>
        </form>
      )}

      <div className="mb-3 flex flex-wrap gap-2 max-w-4xl">
        <input aria-label="filter projects" placeholder="Filter by name/code..." className="px-3 py-2 rounded bg-surface-container-lowest border border-subtle text-sm w-64" value={q} onChange={(e) => setQ(e.target.value)} />
        <select aria-label="filter by project status" className="px-3 py-2 rounded bg-surface-container-lowest border border-subtle text-sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          {PROJECT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <span className="text-xs text-outline self-center">{visible.length}/{projects.length} — sorted by code</span>
      </div>

      <ul className="space-y-1 max-w-4xl mb-4">
        {visible.map((p) => {
          const st = p.project_status || "Active";
          const pc = p.color || "#6b7280";
          return (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 bg-surface-container-lowest border px-3 py-2 rounded text-sm" style={{ borderLeft: `3px solid ${pc}`, borderColor: `${pc}44`, borderLeftColor: pc }}>
              <span className="flex flex-wrap items-center gap-2">
                <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: pc }} title={pc} />
                <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded" style={{ backgroundColor: `${pc}22`, color: pc }}>{p.code}</span>
                <span>{p.name}</span>
                {p.start_date && <span className="text-[11px] text-outline">{p.start_date}</span>}
                <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border" style={{ borderColor: statusColor(st), color: statusColor(st) }}>
                  <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: statusColor(st) }} />{st}
                </span>
              </span>
              <Link to={`/projects/${p.id}/list`} className="text-xs text-primary underline">Open</Link>
            </li>
          );
        })}
        {visible.length === 0 && <li className="text-outline text-sm">{projects.length === 0 ? "No projects yet." : "No projects match filter."}</li>}
      </ul>
    </main>
  );
}
