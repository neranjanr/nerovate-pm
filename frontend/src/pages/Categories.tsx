import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../stores/auth";
import { useTheme } from "../stores/theme";

interface Category {
  id: number;
  key: string;
  name: string;
  color: string;
  status_profile_id?: number | null;
  project_count?: number;
  profile_name?: string | null;
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

export default function Categories() {
  const auth = useAuth();
  const { theme, setTheme } = useTheme();
  const isSample = theme === "sample";
  const [categories, setCategories] = useState<Category[]>([]);
  const [q, setQ] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState("#6b7280");
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Category | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [memberUserId, setMemberUserId] = useState("");
  const [rename, setRename] = useState("");
  const [catProjects, setCatProjects] = useState<{ id: number; code: string; name: string }[]>([]);
  const [showAddProject, setShowAddProject] = useState(false);
  const [projName, setProjName] = useState("");
  const [projCode, setProjCode] = useState("");
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [profileId, setProfileId] = useState("");
  const [stages, setStages] = useState<Stage[]>([]);
  const [profileStatuses, setProfileStatuses] = useState<ProfileStatus[]>([]);
  const [newStageName, setNewStageName] = useState("");
  const [newStageColor, setNewStageColor] = useState("#6b7280");
  const [newStatusName, setNewStatusName] = useState("");
  const [newStatusStage, setNewStatusStage] = useState("");
  const [replacementId, setReplacementId] = useState("");
  const [stageNotice, setStageNotice] = useState("");

  const fetchCategories = () => {
    if (!auth.accessToken) return;
    fetch("/api/v1/categories", {
      headers: { Authorization: `Bearer ${auth.accessToken}` },
    })
      .then((r) => (r.ok ? r.json() : []))
      .then(setCategories)
      .catch(() => setCategories([]));
  };

  useEffect(() => {
    fetchCategories();
  }, [auth.accessToken]);

  const fetchMembers = (id: number) => {
    fetch(`/api/v1/categories/${id}/members`, {
      headers: { Authorization: `Bearer ${auth.accessToken}` },
    })
      .then((r) => (r.ok ? r.json() : []))
      .then(setMembers)
      .catch(() => setMembers([]));
  };

  const fetchCatProjects = (id: number) => {
    fetch(`/api/v1/categories/${id}/projects`, {
      headers: { Authorization: `Bearer ${auth.accessToken}` },
    })
      .then((r) => (r.ok ? r.json() : []))
      .then(setCatProjects)
      .catch(() => setCatProjects([]));
  };

  const fetchProfiles = () => {
    fetch(`/api/v1/status-profiles`, {
      headers: { Authorization: `Bearer ${auth.accessToken}` },
    })
      .then((r) => (r.ok ? r.json() : []))
      .then((all) => setProfiles((all as { id: number; name: string }[]).map((p) => ({ id: p.id, name: p.name }))))
      .catch(() => setProfiles([]));
  };

  const fetchStages = (pid: number) => {
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

  const handleSelect = (c: Category) => {
    setSelected(c);
    setRename(c.name);
    setProfileId(c.status_profile_id ? String(c.status_profile_id) : "");
    setStageNotice("");
    fetchMembers(c.id);
    fetchCatProjects(c.id);
    fetchProfiles();
    if (c.status_profile_id) fetchStages(c.status_profile_id);
    else {
      setStages([]);
      setProfileStatuses([]);
    }
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    fetch("/api/v1/categories", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth.accessToken}`,
      },
      body: JSON.stringify({ name, color }),
    })
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body.detail || "Failed to create category");
        }
        return r.json();
      })
      .then(() => {
        setName("");
        setColor("#6b7280");
        setShowCreate(false);
        fetchCategories();
      })
      .catch((err) => setError(err.message));
  };

  const handleRename = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected) return;
    setError("");
    fetch(`/api/v1/categories/${selected.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth.accessToken}`,
      },
      body: JSON.stringify({ name: rename }),
    })
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body.detail || "Failed to rename");
        }
        return r.json();
      })
      .then((updated: Category) => {
        setSelected(updated);
        fetchCategories();
      })
      .catch((err) => setError(err.message));
  };

  const handleSetProfile = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected || !profileId) return;
    setError("");
    setStageNotice("");
    fetch(`/api/v1/categories/${selected.id}`, {
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
        setSelected(updated);
        fetchCategories();
        fetchStages(Number(profileId));
        setStageNotice("Profile linked (live reference — edits visible to all projects).");
      })
      .catch((err) => setError(err.message));
  };

  const handleCreateStage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!profileId || !newStageName.trim()) return;
    fetch(`/api/v1/status-profiles/${profileId}/stages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth.accessToken}`,
      },
      body: JSON.stringify({ name: newStageName.trim(), color_base: newStageColor }),
    }).then(async (r) => {
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || "Create stage failed");
      setNewStageName("");
      fetchStages(Number(profileId));
    }).catch((err) => setError(err.message));
  };

  const handleDeleteStage = (stageId: number) => {
    fetch(`/api/v1/stages/${stageId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${auth.accessToken}` },
    }).then(async (r) => {
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.detail?.message || body.detail || "Delete stage failed (move statuses first)");
      }
      fetchStages(Number(profileId));
    }).catch((err) => setError(err.message));
  };

  const handleCreateStatus = (e: React.FormEvent) => {
    e.preventDefault();
    if (!profileId || !newStatusName.trim() || !newStatusStage) return;
    fetch(`/api/v1/status-profiles/${profileId}/statuses`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth.accessToken}`,
      },
      body: JSON.stringify({ name: newStatusName.trim(), stage_id: Number(newStatusStage) }),
    }).then(async (r) => {
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || "Create status failed");
      setNewStatusName("");
      fetchStages(Number(profileId));
      setStageNotice("Status added — visible immediately, history untouched.");
    }).catch((err) => setError(err.message));
  };

  const handleDeleteStatus = (statusId: number) => {
    setError("");
    setStageNotice("");
    const qs = replacementId ? `?replacement_id=${Number(replacementId)}` : "";
    fetch(`/api/v1/statuses/${statusId}${qs}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${auth.accessToken}` },
    }).then(async (r) => {
      if (r.status === 409) {
        const body = await r.json().catch(() => ({}));
        const d = body.detail || {};
        throw new Error(
          `Status in use (tasks: ${d.usage_tasks ?? "?"}, periods: ${d.usage_periods ?? "?"}). Pick a replacement below and retry.`
        );
      }
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || "Delete status failed");
      fetchStages(Number(profileId));
      setStageNotice("Status deleted (remapped with history where a replacement was chosen).");
    }).catch((err) => setError(err.message));
  };

  const handleAddProject = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected) return;
    setError("");
    fetch("/api/v1/projects", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth.accessToken}`,
      },
      body: JSON.stringify({ name: projName, code: projCode.trim() || undefined, category_id: selected.id }),
    })
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body.detail || "Failed to create project");
        }
        return r.json();
      })
      .then(() => {
        setProjName("");
        setProjCode("");
        setShowAddProject(false);
        fetchCatProjects(selected.id);
        fetchCategories();
      })
      .catch((err) => setError(err.message));
  };

  const handleAddMember = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected || !memberUserId) return;
    fetch(`/api/v1/categories/${selected.id}/members`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth.accessToken}`,
      },
      body: JSON.stringify({ user_id: Number(memberUserId), role: "member" }),
    }).then(() => {
      setMemberUserId("");
      fetchMembers(selected.id);
    });
  };

  const filtered = categories.filter(
    (c) =>
      c.name.toLowerCase().includes(q.toLowerCase()) ||
      c.key.toLowerCase().includes(q.toLowerCase())
  );

  const canCreate = auth.role === "admin" || auth.role === "manager";

  return (
    <main
      className={
        isSample
          ? "p-space-lg bg-surface min-h-screen text-on-surface"
          : "p-6 bg-slate-950 min-h-screen text-slate-100"
      }
    >
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className={isSample ? "text-headline-lg font-headline-lg" : "text-2xl font-semibold"}>
            Categories Directory
          </h1>
          <p className={isSample ? "text-body-sm font-body-sm text-on-surface-variant mt-0.5" : "text-sm text-slate-400 mt-1"}>
            Browse your assigned categories — <Link to="/projects" className="underline">Projects Directory</Link>
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className={isSample ? "text-label-mono font-label-mono text-outline" : "text-xs text-slate-400"}>
            {auth.username} (<span className="capitalize">{auth.role}</span>)
          </div>
          <div className="flex items-center gap-1 text-xs">
            <button
              onClick={() => setTheme("sample")}
              className={`px-2 py-1 rounded ${isSample ? "bg-primary-container text-on-primary-container font-semibold" : "bg-slate-800 text-slate-300"}`}
            >
              Sample
            </button>
            <button
              onClick={() => setTheme("legacy")}
              className={`px-2 py-1 rounded ${!isSample ? "bg-indigo-600 text-white font-semibold" : "bg-surface-container-high text-on-surface-variant"}`}
            >
              Legacy
            </button>
          </div>
          {canCreate && (
            <button
              onClick={() => setShowCreate(!showCreate)}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded font-medium text-sm transition-colors"
            >
              {showCreate ? "Cancel" : "+Add Category"}
            </button>
          )}
        </div>
      </div>

      {showCreate && canCreate && (
        <form onSubmit={handleCreate} className="mb-6 bg-slate-900 p-4 rounded border border-slate-800 max-w-xl">
          <h2 className="text-lg font-medium mb-3">Create New Category</h2>
          {error && <div className="mb-3 text-sm text-rose-400">{error}</div>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Category Name *</label>
              <input
                required
                className="w-full px-3 py-2 rounded bg-slate-800 text-sm border border-slate-700"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Procurements"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Color</label>
              <input
                type="color"
                className="w-full h-10 px-1 py-1 rounded bg-slate-800 text-sm border border-slate-700"
                value={color}
                onChange={(e) => setColor(e.target.value)}
              />
            </div>
          </div>
          <button type="submit" className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded text-sm font-medium text-white">
            Create Category
          </button>
        </form>
      )}

      <div className="mb-4">
        <input
          aria-label="search categories"
          placeholder="Search by name or key..."
          className={
            isSample
              ? "px-space-md py-1 rounded bg-surface-container-lowest border border-subtle w-full max-w-md text-body-sm font-body-sm text-on-surface"
              : "px-3 py-2 rounded bg-slate-900 border border-slate-800 w-full max-w-md text-sm text-slate-200"
          }
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      <div className={isSample ? "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-space-md" : "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"}>
        {filtered.map((c) => (
          <div
            key={c.id}
            onClick={() => handleSelect(c)}
            className={
              isSample
                ? "bg-surface-container-low border border-subtle hover:border-strong rounded p-space-md cursor-pointer transition-all flex flex-col justify-between shadow-sm"
                : "bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-lg p-4 cursor-pointer transition-all flex flex-col justify-between"
            }
          >
            <div>
          <div className="mb-4 rounded border border-slate-800 bg-slate-950/60 p-3">
            <h3 className="text-sm font-semibold mb-2">Status Profile (live reference)</h3>
            {stageNotice && <div className="mb-2 text-xs text-emerald-300">{stageNotice}</div>}
            {canCreate ? (
              <form onSubmit={handleSetProfile} className="flex flex-wrap gap-2 mb-3">
                <select
                  aria-label="status profile"
                  className="flex-1 min-w-40 px-3 py-2 rounded bg-slate-800 text-sm border border-slate-700"
                  value={profileId}
                  onChange={(e) => setProfileId(e.target.value)}
                >
                  <option value="">Select profile...</option>
                  {profiles.map((p) => (
                    <option key={p.id} value={String(p.id)}>
                      #{p.id} {p.name}
                    </option>
                  ))}
                </select>
                <button type="submit" className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded text-sm font-medium text-white">
                  Link profile
                </button>
              </form>
            ) : (
              <p className="text-xs text-slate-400 mb-2">Profile: {selected?.profile_name || "Not set"}</p>
            )}
            {profileId && (
              <div className="space-y-3">
                {stages.map((st) => (
                  <div key={st.id} className="rounded border border-slate-800 bg-slate-900 px-3 py-2">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-2 text-sm">
                        <span className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: st.color_base }} />
                        <strong>{st.name}</strong>
                        <span className="text-xs text-slate-500">order {st.order}</span>
                      </span>
                      {canCreate && (
                        <button onClick={() => handleDeleteStage(st.id)} className="text-xs text-rose-400 hover:text-rose-300">
                          Delete stage
                        </button>
                      )}
                    </div>
                    <ul className="mt-2 space-y-1">
                      {profileStatuses
                        .filter((s) => s.stage_id === st.id)
                        .map((s) => (
                          <li key={s.id} className="flex items-center justify-between bg-slate-800 px-2.5 py-1 rounded text-xs">
                            <span>
                              <span
                                className="inline-block w-2.5 h-2.5 rounded-full mr-2"
                                style={{ backgroundColor: s.shade || s.color }}
                                title={s.shade || s.color}
                              />
                              {s.name}
                            </span>
                            {canCreate && (
                              <button onClick={() => handleDeleteStatus(s.id)} className="text-rose-400 hover:text-rose-300">
                                Delete
                              </button>
                            )}
                          </li>
                        ))}
                    </ul>
                  </div>
                ))}
                {canCreate && (
                  <>
                    <form onSubmit={handleCreateStage} className="flex flex-wrap gap-2">
                      <input
                        aria-label="new stage name"
                        placeholder="New stage name"
                        className="flex-1 min-w-40 px-3 py-2 rounded bg-slate-800 text-sm border border-slate-700"
                        value={newStageName}
                        onChange={(e) => setNewStageName(e.target.value)}
                      />
                      <input
                        aria-label="new stage color"
                        type="color"
                        className="w-12 h-10 px-1 rounded bg-slate-800 border border-slate-700"
                        value={newStageColor}
                        onChange={(e) => setNewStageColor(e.target.value)}
                      />
                      <button type="submit" className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded text-sm text-white">
                        +Add Stage
                      </button>
                    </form>
                    <form onSubmit={handleCreateStatus} className="flex flex-wrap gap-2">
                      <input
                        aria-label="new status name"
                        placeholder="New status name"
                        className="flex-1 min-w-40 px-3 py-2 rounded bg-slate-800 text-sm border border-slate-700"
                        value={newStatusName}
                        onChange={(e) => setNewStatusName(e.target.value)}
                      />
                      <select
                        aria-label="target stage"
                        required
                        className="px-3 py-2 rounded bg-slate-800 text-sm border border-slate-700"
                        value={newStatusStage}
                        onChange={(e) => setNewStatusStage(e.target.value)}
                      >
                        <option value="">Stage...</option>
                        {stages.map((st) => (
                          <option key={st.id} value={String(st.id)}>
                            {st.name}
                          </option>
                        ))}
                      </select>
                      <button type="submit" className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded text-sm text-white">
                        +Add Status
                      </button>
                    </form>
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="text-xs text-slate-400">Replacement for delete (same profile):</label>
                      <select
                        aria-label="replacement status"
                        className="px-3 py-2 rounded bg-slate-800 text-sm border border-slate-700"
                        value={replacementId}
                        onChange={(e) => setReplacementId(e.target.value)}
                      >
                        <option value="">None (unused only)...</option>
                        {profileStatuses.map((s) => (
                          <option key={s.id} value={String(s.id)}>
                            #{s.id} {s.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center justify-between mb-2">
                <span className="flex items-center gap-2">
                  <span
                    className="inline-block w-3 h-3 rounded-full"
                    style={{ backgroundColor: c.color }}
                    title={c.color}
                  />
                  <span
                    className={
                      isSample
                        ? "font-label-mono text-label-mono px-space-xs py-0.5 rounded bg-primary-container text-on-primary-container font-semibold"
                        : "font-mono text-xs px-2 py-0.5 rounded bg-indigo-950 text-indigo-300 font-semibold"
                    }
                  >
                    {c.key}
                  </span>
                </span>
                <span className={isSample ? "text-label-mono font-label-mono text-on-surface-variant" : "text-xs text-slate-400"}>
                  Projects: <strong className={isSample ? "text-on-surface" : "text-slate-200"}>{c.project_count ?? 0}</strong>
                </span>
              </div>
              <h2 className={isSample ? "text-title-sm font-title-sm text-on-surface mb-1" : "text-base font-semibold text-slate-100 mb-1"}>{c.name}</h2>
              <p className={isSample ? "text-body-sm font-body-sm text-on-surface-variant" : "text-xs text-slate-400"}>
                Profile: {c.profile_name || "Not set"}
              </p>
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="col-span-full py-12 text-center text-slate-500">
            No categories found.
          </div>
        )}
      </div>

      {selected && (
        <div className="mt-6 bg-slate-900 p-4 rounded border border-slate-800 max-w-2xl">
          <h2 className="text-lg font-medium mb-1">Category: {selected.name}</h2>
          <p className="text-xs text-slate-400 mb-3">Key {selected.key} (immutable — rename preserves key)</p>
          {error && <div className="mb-3 text-sm text-rose-400">{error}</div>}
          {canCreate && (
            <form onSubmit={handleRename} className="flex gap-2 mb-4">
              <input
                aria-label="rename category"
                className="flex-1 px-3 py-2 rounded bg-slate-800 text-sm border border-slate-700"
                value={rename}
                onChange={(e) => setRename(e.target.value)}
              />
              <button type="submit" className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded text-sm font-medium text-white">
                Rename
              </button>
            </form>
          )}
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold">Projects ({catProjects.length})</h3>
            <div className="flex items-center gap-2">
              <Link to={`/projects?category_id=${selected.id}`} className="text-xs text-indigo-300 underline">
                Open Project list
              </Link>
              {canCreate && (
                <button
                  onClick={() => setShowAddProject(!showAddProject)}
                  className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 rounded text-xs font-medium text-white"
                >
                  {showAddProject ? "Cancel" : "+Add Project"}
                </button>
              )}
            </div>
          </div>
          {showAddProject && canCreate && (
            <form onSubmit={handleAddProject} className="flex flex-wrap gap-2 mb-3">
              <input
                required
                aria-label="project name"
                placeholder="Project name"
                className="flex-1 min-w-40 px-3 py-2 rounded bg-slate-800 text-sm border border-slate-700"
                value={projName}
                onChange={(e) => setProjName(e.target.value)}
              />
              <input
                aria-label="project code"
                placeholder="Code (optional)"
                className="w-32 px-3 py-2 rounded bg-slate-800 text-sm border border-slate-700 uppercase"
                value={projCode}
                onChange={(e) => setProjCode(e.target.value)}
              />
              <button type="submit" className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded text-sm font-medium text-white">
                Create
              </button>
            </form>
          )}
          <ul className="text-sm text-slate-300 mb-4 space-y-1">
            {catProjects.map((p) => (
              <li key={p.id} className="flex items-center justify-between bg-slate-800 px-3 py-1.5 rounded">
                <span>
                  <span className="font-mono text-xs text-indigo-300 font-semibold mr-2">{p.code}</span>
                  {p.name}
                </span>
                <Link to={`/projects/${p.id}/timeline`} className="text-xs text-indigo-300 underline">
                  Open
                </Link>
              </li>
            ))}
            {catProjects.length === 0 && <li className="text-slate-500">No projects yet.</li>}
          </ul>
          <h3 className="text-sm font-semibold mb-2">Members</h3>          <ul className="text-sm text-slate-300 mb-3 space-y-1">
            {members.map((m) => (
              <li key={m.user_id} className="flex items-center justify-between bg-slate-800 px-3 py-1.5 rounded">
                <span>User #{m.user_id} ({m.role})</span>
                {canCreate && (
                  <button
                    onClick={() => {
                      fetch(`/api/v1/categories/${selected.id}/members/${m.user_id}`, {
                        method: "DELETE",
                        headers: { Authorization: `Bearer ${auth.accessToken}` },
                      }).then(() => fetchMembers(selected.id));
                    }}
                    className="text-xs text-rose-400 hover:text-rose-300"
                  >
                    Remove
                  </button>
                )}
              </li>
            ))}
            {members.length === 0 && <li className="text-slate-500">No members yet.</li>}
          </ul>
          {canCreate && (
            <form onSubmit={handleAddMember} className="flex gap-2">
              <input
                aria-label="member user id"
                placeholder="User ID"
                className="w-32 px-3 py-2 rounded bg-slate-800 text-sm border border-slate-700"
                value={memberUserId}
                onChange={(e) => setMemberUserId(e.target.value)}
              />
              <button type="submit" className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded text-sm font-medium text-white">
                Add member
              </button>
            </form>
          )}
        </div>
      )}
    </main>
  );
}
