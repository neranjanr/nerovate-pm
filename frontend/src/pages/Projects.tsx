import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../stores/auth";
import { useTheme } from "../stores/theme";

interface Project {
  id: number;
  code: string;
  name: string;
  category_id?: number | null;
  category_name?: string | null;
  description: string;
  start_date?: string | null;
  target_date?: string | null;
  task_count?: number;
  owner_name?: string | null;
}

interface Category {
  id: number;
  key: string;
  name: string;
}

export default function Projects() {
  const auth = useAuth();
  const { theme, setTheme } = useTheme();
  const isSample = theme === "sample";
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<string>("");
  const [q, setQ] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [error, setError] = useState("");

  const fetchProjects = (catId?: string) => {
    if (!auth.accessToken) return;
    const qs = catId ? `?category_id=${catId}` : "";
    fetch(`/api/v1/projects${qs}`, {
      headers: { Authorization: `Bearer ${auth.accessToken}` }
    })
      .then((r) => (r.ok ? r.json() : []))
      .then(setProjects)
      .catch(() => setProjects([]));
  };

  useEffect(() => {
    if (!auth.accessToken) return;
    fetch("/api/v1/categories", {
      headers: { Authorization: `Bearer ${auth.accessToken}` }
    })
      .then((r) => (r.ok ? r.json() : []))
      .then((cats: Category[]) => {
        setCategories(cats);
        const params = new URLSearchParams(window.location.search);
        const preset = params.get("category_id") || "";
        if (preset) {
          setCategoryFilter(preset);
          setCategoryId(preset);
          fetchProjects(preset);
        } else {
          fetchProjects();
        }
      })
      .catch(() => fetchProjects());
  }, [auth.accessToken]);

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const cid = Number(categoryId || categoryFilter);
    if (!cid) {
      setError("Category is required — pick a Category first.");
      return;
    }
    fetch("/api/v1/projects", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth.accessToken}`
      },
      body: JSON.stringify({
        name,
        code: code.trim() || undefined,
        category_id: cid,
        start_date: startDate || undefined,
        target_date: targetDate || undefined
      })
    })
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body.detail || "Failed to create project");
        }
        return r.json();
      })
      .then(() => {
        setName("");
        setCode("");
        setStartDate("");
        setTargetDate("");
        setShowCreate(false);
        fetchProjects(categoryFilter || undefined);
      })
      .catch((err) => setError(err.message));
  };

  const filtered = projects.filter(
    (p) =>
      p.name.toLowerCase().includes(q.toLowerCase()) ||
      p.code.toLowerCase().includes(q.toLowerCase())
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
          <h1 className={isSample ? "text-headline-lg font-headline-lg" : "text-2xl font-semibold"}>Projects Directory</h1>
          <p className={isSample ? "text-body-sm font-body-sm text-on-surface-variant mt-0.5" : "text-sm text-slate-400 mt-1"}>Browse and search your assigned projects</p>
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
              {showCreate ? "Cancel" : "New Project"}
            </button>
          )}
        </div>
      </div>

      {showCreate && canCreate && (
        <form onSubmit={handleCreate} className="mb-6 bg-slate-900 p-4 rounded border border-slate-800 max-w-xl">
          <h2 className="text-lg font-medium mb-3">Create New Project</h2>
          {error && <div className="mb-3 text-sm text-rose-400">{error}</div>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Category *</label>
              <select
                required
                className="w-full px-3 py-2 rounded bg-slate-800 text-sm border border-slate-700"
                value={categoryId || categoryFilter}
                onChange={(e) => setCategoryId(e.target.value)}
              >
                <option value="">Select category…</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Project Name *</label>
              <input
                required
                className="w-full px-3 py-2 rounded bg-slate-800 text-sm border border-slate-700"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Hardware Upgrade"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Code (optional)</label>
              <input
                className="w-full px-3 py-2 rounded bg-slate-800 text-sm border border-slate-700 uppercase"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="e.g. HW-01"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Start Date *</label>
              <input
                required
                type="date"
                className="w-full px-3 py-2 rounded bg-slate-800 text-sm border border-slate-700"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Target Date</label>
              <input
                type="date"
                className="w-full px-3 py-2 rounded bg-slate-800 text-sm border border-slate-700"
                value={targetDate}
                onChange={(e) => setTargetDate(e.target.value)}
              />
            </div>
          </div>
          <button type="submit" className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded text-sm font-medium text-white">
            Create Project
          </button>
        </form>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          aria-label="search projects"
          placeholder="Search by name or code..."
          className={
            isSample
              ? "px-space-md py-1 rounded bg-surface-container-lowest border border-subtle w-full max-w-md text-body-sm font-body-sm text-on-surface"
              : "px-3 py-2 rounded bg-slate-900 border border-slate-800 w-full max-w-md text-sm text-slate-200"
          }
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          aria-label="filter by category"
          className="px-3 py-2 rounded bg-slate-900 border border-slate-800 text-sm text-slate-200"
          value={categoryFilter}
          onChange={(e) => {
            setCategoryFilter(e.target.value);
            if (!showCreate) setCategoryId(e.target.value);
            fetchProjects(e.target.value || undefined);
          }}
        >
          <option value="">All Categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <div className={isSample ? "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-space-md" : "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"}>
        {filtered.map((p) => (
          <div
            key={p.id}
            onClick={() => navigate(`/projects/${p.id}/timeline`)}
            className={
              isSample
                ? "bg-surface-container-low border border-subtle hover:border-strong rounded p-space-md cursor-pointer transition-all flex flex-col justify-between shadow-sm"
                : "bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-lg p-4 cursor-pointer transition-all flex flex-col justify-between"
            }
          >
            <div>
              <div className="flex items-center justify-between mb-2">
                <span
                  className={
                    isSample
                      ? "font-label-mono text-label-mono px-space-xs py-0.5 rounded bg-primary-container text-on-primary-container font-semibold"
                      : "font-mono text-xs px-2 py-0.5 rounded bg-indigo-950 text-indigo-300 font-semibold"
                  }
                >
                  {p.code}
                </span>
                <span className={isSample ? "text-label-mono font-label-mono text-on-surface-variant" : "text-xs text-slate-400"}>
                  Tasks: <strong className={isSample ? "text-on-surface" : "text-slate-200"}>{p.task_count ?? 0}</strong>
                </span>
              </div>
              <h2 className={isSample ? "text-title-sm font-title-sm text-on-surface mb-1" : "text-base font-semibold text-slate-100 mb-1"}>{p.name}</h2>
              <p className={isSample ? "text-xs text-on-surface-variant" : "text-xs text-slate-500"}>
                {p.category_name || (categories.find((c) => c.id === p.category_id)?.name ?? "")} {p.category_name || p.category_id ? "›" : ""} {p.code}
              </p>
              <p className={isSample ? "text-body-sm font-body-sm text-on-surface-variant line-clamp-2" : "text-xs text-slate-400 line-clamp-2"}>{p.description || "No description provided."}</p>
            </div>
            <div
              className={
                isSample
                  ? "mt-4 pt-3 border-t border-subtle flex items-center justify-between text-label-mono font-label-mono text-outline"
                  : "mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400"
              }
            >
              <span>Span: {p.start_date || "Not set"} {p.target_date ? `→ ${p.target_date}` : ""}</span>
              {p.owner_name && <span>Owner: {p.owner_name}</span>}
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="col-span-full py-12 text-center text-slate-500">
            No projects found.
          </div>
        )}
      </div>
    </main>
  );
}
