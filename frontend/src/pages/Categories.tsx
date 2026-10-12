import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../stores/auth";
import { useTheme } from "../stores/theme";

export const PROJECT_STATUSES = ["Not Started", "Active", "Complete"] as const;

export function projectStatusColor(s?: string | null) {
  if (s === "Complete") return "#10b981";
  if (s === "Not Started") return "#6b7280";
  return "#3b82f6";
}

interface Category {
  id: number;
  key: string;
  name: string;
  color: string;
  status_profile_id?: number | null;
  project_count?: number;
  profile_name?: string | null;
}

interface Profile {
  id: number;
  name: string;
}

export default function Categories() {
  const auth = useAuth();
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();
  const isSample = theme !== "legacy";
  const [categories, setCategories] = useState<Category[]>([]);
  const [q, setQ] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState("#6b7280");
  const [customColor, setCustomColor] = useState("#6b7280");
  const CATEGORY_COLORS = [
    "#6b7280",
    "#3b82f6",
    "#10b981",
    "#f59e0b",
    "#ef4444",
    "#8b5cf6",
    "#ec4899",
    "#06b6d4",
  ];
  const [error, setError] = useState("");
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [createProfileId, setCreateProfileId] = useState("");

  const fetchCategories = () => {
    if (!auth.accessToken) return;
    fetch("/api/v1/categories", {
      headers: { Authorization: `Bearer ${auth.accessToken}` },
    })
      .then((r) => (r.ok ? r.json() : []))
      .then(setCategories)
      .catch(() => setCategories([]));
  };

  const fetchProfiles = () => {
    if (!auth.accessToken) return;
    fetch(`/api/v1/status-profiles`, {
      headers: { Authorization: `Bearer ${auth.accessToken}` },
    })
      .then((r) => (r.ok ? r.json() : []))
      .then((all) => setProfiles((all as { id: number; name: string }[]).map((p) => ({ id: p.id, name: p.name }))))
      .catch(() => setProfiles([]));
  };

  useEffect(() => {
    fetchCategories();
    fetchProfiles();
  }, [auth.accessToken]);

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const payload: { name: string; color: string; status_profile_id?: number } = {
      name,
      color,
    };
    if (createProfileId && createProfileId !== "__new__") {
      payload.status_profile_id = Number(createProfileId);
    }
    fetch("/api/v1/categories", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth.accessToken}`,
      },
      body: JSON.stringify(payload),
    })
      .then(async (r) => {
        if (r.status === 401) {
          auth.logout();
          window.location.href = "/login";
          throw new Error("Session expired — please log in again.");
        }
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body.detail || "Failed to create category");
        }
        return r.json();
      })
      .then(() => {
        setName("");
        setColor("#6b7280");
        setCreateProfileId("");
        setShowCreate(false);
        fetchCategories();
      })
      .catch((err) => setError(err.message));
  };

  const filtered = categories
    .filter(
      (c) =>
        c.name.toLowerCase().includes(q.toLowerCase()) ||
        c.key.toLowerCase().includes(q.toLowerCase())
    )
    .sort((a, b) => a.name.localeCompare(b.name));

  const canCreate = auth.role === "admin" || auth.role === "manager";
  const totalProjects = categories.reduce((n, c) => n + (c.project_count ?? 0), 0);
  const withProjects = categories.filter((c) => (c.project_count ?? 0) > 0).length;
  const emptyCount = categories.length - withProjects;

  if (!isSample) {
    return (
      <main className="p-6 bg-surface min-h-screen text-on-surface">
        <h1 className="text-2xl font-semibold">Categories Directory</h1>
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((c) => (
            <div key={c.id} onClick={() => navigate(`/categories/${c.id}`)} className="bg-surface-container-lowest border border-subtle rounded-lg p-4 cursor-pointer">
              <h2 className="text-base font-semibold">{c.name}</h2>
            </div>
          ))}
          {filtered.length === 0 && <div className="col-span-full py-12 text-center text-outline">No categories found.</div>}
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900 px-6 py-6">
      <div className="flex flex-col w-full space-y-6">
        {/* Header */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">Categories Directory</h1>
              <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 text-xs font-semibold">
                Active Workspace
              </span>
            </div>
            <p className="text-sm text-slate-500 mt-0.5">
              Browse your assigned categories — <Link to="/projects" className="underline text-blue-700">Projects Directory</Link>
            </p>
          </div>
          <div className="flex items-center flex-wrap gap-2">
            <span className="text-xs text-slate-500 mr-1">
              {auth.username} (<span className="capitalize">{auth.role}</span>)
            </span>
            <span className="flex items-center gap-1 text-xs mr-1">
              <button onClick={() => setTheme("enterprise")} className={`px-2 py-1 rounded ${theme === "enterprise" ? "bg-slate-900 text-white font-semibold" : "bg-white border border-slate-200 text-slate-600"}`}>Enterprise</button>
              <button onClick={() => setTheme("sample")} className={`px-2 py-1 rounded ${theme === "sample" ? "bg-slate-900 text-white font-semibold" : "bg-white border border-slate-200 text-slate-600"}`}>Sample</button>
              <button onClick={() => setTheme("legacy")} className={`px-2 py-1 rounded ${!isSample ? "bg-slate-900 text-white font-semibold" : "bg-white border border-slate-200 text-slate-600"}`}>Legacy</button>
            </span>
            {canCreate && (
              <button
                onClick={() => setShowCreate(!showCreate)}
                className="px-4 py-1.5 rounded-lg bg-slate-900 text-white hover:bg-slate-800 text-[13px] font-semibold shadow-sm flex items-center gap-1.5"
                type="button"
              >
                <span className="text-[16px]">+</span> {showCreate ? "Cancel" : "New Category"}
              </button>
            )}
          </div>
        </div>

        {showCreate && canCreate && (
          <form onSubmit={handleCreate} className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm max-w-2xl">
            <h2 className="text-base font-semibold text-slate-900 mb-3">Create New Category</h2>
            {error && <div className="mb-3 text-sm text-red-600">{error}</div>}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-xs text-slate-500 mb-1">Category Name *</label>
                <input required className="w-full h-10 px-3 rounded-lg bg-slate-50 text-sm border border-slate-200 text-slate-900" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Procurements" />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Color</label>
                <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="category color">
                  {CATEGORY_COLORS.map((c) => (
                    <button key={c} type="button" role="radio" aria-checked={color === c} title={c} onClick={() => setColor(c)}
                      className={`w-8 h-8 rounded border ${color === c ? "ring-2 ring-slate-900 ring-offset-2" : "border-slate-200 hover:border-slate-400"}`}
                      style={{ backgroundColor: c }} />
                  ))}
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <input aria-label="custom color" type="color" className="w-8 h-8 rounded bg-transparent" value={/^#[0-9a-fA-F]{6}$/.test(customColor) ? customColor : "#6b7280"} onChange={(e) => { setCustomColor(e.target.value); setColor(e.target.value.toLowerCase()); }} />
                  <span className="font-mono text-xs text-slate-500">{color}</span>
                </div>
              </div>
            </div>
            <div className="mb-3">
              <label className="block text-xs text-slate-500 mb-1">Status Profile (optional)</label>
              <select aria-label="status profile for new category" className="w-full h-10 px-3 rounded-lg bg-slate-50 text-sm border border-slate-200 text-slate-900" value={createProfileId} onChange={(e) => { if (e.target.value === "__new__") { window.location.href = "/settings"; } else { setCreateProfileId(e.target.value); } }}>
                <option value="">No profile (link later)...</option>
                {profiles.map((p) => (<option key={p.id} value={String(p.id)}>#{p.id} {p.name}</option>))}
                <option value="__new__">+ (new) — create in Global Settings…</option>
              </select>
            </div>
            <button type="submit" className="px-4 py-2 bg-slate-900 hover:bg-slate-800 rounded-lg text-sm font-semibold text-white">Create Category</button>
          </form>
        )}

        {/* KPI strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-sm flex items-center justify-between">
            <div>
              <p className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">Total Categories</p>
              <p className="text-2xl font-bold text-slate-900 mt-1">{categories.length}</p>
              <p className="text-xs text-slate-400 mt-0.5">{filtered.length} shown</p>
            </div>
            <div className="w-10 h-10 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center border border-slate-200">▦</div>
          </div>
          <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-sm flex items-center justify-between">
            <div>
              <p className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">Total Projects</p>
              <p className="text-2xl font-bold text-slate-900 mt-1">{totalProjects}</p>
              <p className="text-xs text-slate-400 mt-0.5">across categories</p>
            </div>
            <div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center border border-blue-100">▤</div>
          </div>
          <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-sm flex items-center justify-between">
            <div>
              <p className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">With Projects</p>
              <p className="text-2xl font-bold text-slate-900 mt-1">{withProjects}</p>
              <p className="text-xs text-emerald-700 font-medium mt-0.5">non-empty</p>
            </div>
            <div className="w-10 h-10 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center border border-emerald-100">✓</div>
          </div>
          <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-sm flex items-center justify-between">
            <div>
              <p className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">Empty</p>
              <p className="text-2xl font-bold text-slate-900 mt-1">{emptyCount}</p>
              <p className="text-xs text-slate-400 mt-0.5">no projects yet</p>
            </div>
            <div className="w-10 h-10 rounded-lg bg-slate-50 text-slate-500 flex items-center justify-center border border-slate-200">○</div>
          </div>
        </div>

        {/* Filter toolstrip */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 flex-1">
            <div className="relative min-w-[240px] flex-1 max-w-md">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[16px] text-slate-400">⌕</span>
              <input aria-label="search categories" placeholder="Search categories by name, key or tag..." className="w-full h-10 pl-9 pr-3 rounded-lg bg-slate-50 text-sm text-slate-900 placeholder:text-slate-400 outline-none ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-600 focus:bg-white" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <button onClick={() => setQ("")} className="h-10 px-3 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 text-[13px] flex items-center gap-1.5" type="button">Reset Filters</button>
          </div>
          <span className="text-xs text-slate-400 shrink-0">{filtered.length} of {categories.length} categories</span>
        </div>

        {/* Matrix */}
        <div className="flex flex-col space-y-4">
          <div className="bg-white px-6 py-3.5 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between text-slate-600 text-[13px]">
            <div className="flex items-center gap-3">
              <span className="text-xs text-slate-500 uppercase tracking-wider font-semibold">Categories Matrix // Default Enterprise</span>
              <span className="w-1.5 h-1.5 rounded-full bg-slate-300" />
              <span className="font-semibold text-slate-800">{withProjects} active of {categories.length} total categories</span>
            </div>
            <span className="text-slate-500">Sorted by: <strong className="text-slate-900 font-semibold">Name</strong></span>
          </div>
          <div className="flex flex-col gap-2.5">
            {filtered.map((c) => (
              <div
                key={c.id}
                onClick={() => navigate(`/categories/${c.id}`)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") navigate(`/categories/${c.id}`); }}
                role="button"
                tabIndex={0}
                aria-label={`Open category ${c.name}`}
                style={{ borderLeftColor: c.color }}
                className="flex items-center gap-4 py-3.5 px-5 bg-white border border-slate-200 border-l-4 rounded-xl shadow-sm hover:border-slate-300 transition-all min-h-[60px] cursor-pointer overflow-x-auto"
              >
                <div className="w-72 flex-shrink-0 flex flex-col justify-center">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: c.color }} />
                    <span className="px-2 py-0.5 rounded text-xs font-semibold shrink-0 border" style={{ backgroundColor: `${c.color}14`, color: c.color, borderColor: `${c.color}55` }}>{c.key}</span>
                    <span className="font-semibold text-slate-900 text-sm whitespace-nowrap overflow-hidden text-ellipsis">{c.name}</span>
                  </div>
                  <span className="text-xs text-slate-500 mt-0.5">{c.profile_name ? `Profile: ${c.profile_name}` : "No profile linked"}</span>
                </div>
                <div className="w-36 flex-shrink-0">
                  <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200 flex items-center gap-1.5 w-fit">
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-500" /> {c.project_count ?? 0} projects
                  </span>
                </div>
                <div className="w-40 flex-shrink-0 text-xs text-slate-500">Key: {c.key} · ID {c.id}</div>
                <div className="flex-shrink-0 ml-auto flex items-center gap-1">
                  <span className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400">›</span>
                </div>
              </div>
            ))}
            {filtered.length === 0 && (
              <div className="p-8 bg-white rounded-xl border border-slate-200 text-center text-slate-400 text-sm">No categories found.</div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
