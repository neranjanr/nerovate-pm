import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../stores/auth";
import { useTheme } from "../stores/theme";

interface Project {
  id: number;
  code: string;
  name: string;
  category_id?: number | null;
  category_name?: string | null;
  description: string;
  color?: string | null;
  start_date?: string | null;
  target_date?: string | null;
  task_count?: number;
  owner_name?: string | null;
  project_status?: string;
}

export const PROJECT_STATUSES = ["Not Started", "Active", "Complete"] as const;

function statusColor(s?: string | null) {
  if (s === "Complete") return "#10b981";
  if (s === "Not Started") return "#6b7280";
  return "#3b82f6";
}

function statusPill(s?: string | null): string {
  const st = s || "Active";
  if (st === "Complete")
    return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (st === "Not Started")
    return "bg-slate-100 text-slate-700 border-slate-200";
  return "bg-blue-50 text-blue-700 border-blue-200";
}

function initials(name?: string | null): string {
  if (!name) return "—";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

interface Category {
  id: number;
  key: string;
  name: string;
}

export default function Projects() {
  const auth = useAuth();
  const { theme, setTheme } = useTheme();
  const isSample = theme !== "legacy";
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [q, setQ] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [color, setColor] = useState("#6b7280");
  const [startDate, setStartDate] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [error, setError] = useState("");
  const PROJECT_COLORS = ["#6b7280","#3b82f6","#10b981","#f59e0b","#ef4444","#8b5cf6","#ec4899","#06b6d4"];

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
      setError("Category is required — create a Category first in Categories, then pick it here.");
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
        color,
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
        setColor("#6b7280");
        setStartDate("");
        setTargetDate("");
        setShowCreate(false);
        fetchProjects(categoryFilter || undefined);
      })
      .catch((err) => setError(err.message));
  };

  const filtered = [...projects]
    .sort((a, b) => a.code.localeCompare(b.code))
    .filter((p) => {
      const ql = q.toLowerCase();
      const matchesText =
        !ql || p.name.toLowerCase().includes(ql) || p.code.toLowerCase().includes(ql);
      const matchesStatus = !statusFilter || (p.project_status || "Active") === statusFilter;
      return matchesText && matchesStatus;
    });

  const resetFilters = () => {
    setQ("");
    setStatusFilter("");
    setCategoryFilter("");
    if (!showCreate) setCategoryId("");
    fetchProjects(undefined);
  };

  const exportCsv = () => {
    const rows = [
      ["code", "name", "category", "status", "tasks", "owner", "start", "target"],
      ...filtered.map((p) => [
        p.code,
        p.name,
        p.category_name || "",
        p.project_status || "Active",
        String(p.task_count ?? ""),
        p.owner_name || "",
        p.start_date || "",
        p.target_date || "",
      ]),
    ];
    const csv = rows
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "projects.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const canCreate = auth.role === "admin" || auth.role === "manager";
  const total = projects.length;
  const activeCount = projects.filter((p) => (p.project_status || "Active") === "Active").length;
  const completeCount = projects.filter((p) => p.project_status === "Complete").length;
  const notStartedCount = projects.filter((p) => p.project_status === "Not Started").length;

  if (!isSample) {
    return (
      <main className="p-6 bg-surface min-h-screen text-on-surface">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold">Projects Directory</h1>
            <p className="text-sm text-on-surface-variant mt-1">Browse and search your assigned projects</p>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-xs text-on-surface-variant">
              {auth.username} (<span className="capitalize">{auth.role}</span>)
            </div>
            {canCreate && (
              <button
                onClick={() => setShowCreate(!showCreate)}
                className="px-4 py-2 bg-primary-container hover:bg-primary text-on-primary rounded font-medium text-sm transition-colors"
              >
                {showCreate ? "Cancel" : "New Project"}
              </button>
            )}
          </div>
        </div>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <input
            aria-label="search projects"
            placeholder="Search by name or code..."
            className="px-3 py-2 rounded bg-surface-container-lowest border border-subtle w-full max-w-md text-sm text-on-surface"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((p) => (
            <div key={p.id} onClick={() => navigate(`/projects/${p.id}/list`)} className="bg-surface-container-lowest border border-subtle rounded-lg p-4 cursor-pointer">
              <h2 className="text-base font-semibold">{p.name}</h2>
              <p className="text-xs text-on-surface-variant">{p.code}</p>
            </div>
          ))}
          {filtered.length === 0 && <div className="col-span-full py-12 text-center text-outline">No projects found.</div>}
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
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">Projects Directory</h1>
              <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 text-xs font-semibold">
                Active Workspace
              </span>
            </div>
            <p className="text-sm text-slate-500 mt-0.5">
              Browse, track, and inspect assigned engineering and operations projects across business categories.
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
            <button onClick={exportCsv} className="px-3 py-1.5 rounded-lg bg-white hover:bg-slate-100 text-slate-700 text-[13px] font-medium flex items-center gap-1.5 border border-slate-200 shadow-sm" type="button">
              <span className="text-[16px] text-slate-500">↓</span> Export CSV
            </button>
            {canCreate && (
              <button
                onClick={() => setShowCreate(!showCreate)}
                className="px-4 py-1.5 rounded-lg bg-slate-900 text-white hover:bg-slate-800 text-[13px] font-semibold shadow-sm flex items-center gap-1.5"
                type="button"
              >
                <span className="text-[16px]">+</span> {showCreate ? "Cancel" : "New Project"}
              </button>
            )}
          </div>
        </div>

        {categories.length === 0 && (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-4 max-w-xl text-sm">
            No Categories yet — create a Category first in{" "}
            <Link to="/categories" className="underline font-medium">Categories</Link>, then create Projects inside it.
          </div>
        )}

        {showCreate && canCreate && (
          <form onSubmit={handleCreate} className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm max-w-2xl">
            <h2 className="text-base font-semibold text-slate-900 mb-3">Create New Project</h2>
            {error && <div className="mb-3 text-sm text-red-600">{error}</div>}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-xs text-slate-500 mb-1">Category *</label>
                <select required className="w-full h-10 px-3 rounded-lg bg-slate-50 text-sm border border-slate-200 text-slate-900" value={categoryId || categoryFilter} onChange={(e) => setCategoryId(e.target.value)}>
                  <option value="">Select category…</option>
                  {categories.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Project Name *</label>
                <input required className="w-full h-10 px-3 rounded-lg bg-slate-50 text-sm border border-slate-200 text-slate-900" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Hardware Upgrade" />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Code (optional)</label>
                <input className="w-full h-10 px-3 rounded-lg bg-slate-50 text-sm border border-slate-200 uppercase text-slate-900" value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. HW-01" />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Start Date *</label>
                <input required type="date" className="w-full h-10 px-3 rounded-lg bg-slate-50 text-sm border border-slate-200 text-slate-900" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Target Date</label>
                <input type="date" className="w-full h-10 px-3 rounded-lg bg-slate-50 text-sm border border-slate-200 text-slate-900" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Color</label>
                <div className="flex flex-wrap gap-1.5">
                  {PROJECT_COLORS.map((c) => (
                    <button key={c} type="button" onClick={() => setColor(c)} className={`w-6 h-6 rounded border ${color === c ? "ring-2 ring-slate-900 ring-offset-2" : "border-slate-200"}`} style={{ backgroundColor: c }} title={c} />
                  ))}
                </div>
              </div>
            </div>
            <button type="submit" className="px-4 py-2 bg-slate-900 hover:bg-slate-800 rounded-lg text-sm font-semibold text-white">Create Project</button>
          </form>
        )}

        {/* KPI strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-sm flex items-center justify-between">
            <div>
              <p className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">Total Projects</p>
              <p className="text-2xl font-bold text-slate-900 mt-1">{total}</p>
              <p className="text-xs text-slate-400 mt-0.5">{filtered.length} shown by filters</p>
            </div>
            <div className="w-10 h-10 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center border border-slate-200">▤</div>
          </div>
          <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-sm flex items-center justify-between">
            <div>
              <p className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">Active</p>
              <p className="text-2xl font-bold text-slate-900 mt-1">{activeCount}</p>
              <p className="text-xs text-slate-400 mt-0.5">in progress</p>
            </div>
            <div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center border border-blue-100">▲</div>
          </div>
          <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-sm flex items-center justify-between">
            <div>
              <p className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">Complete</p>
              <p className="text-2xl font-bold text-slate-900 mt-1">{completeCount}</p>
              <p className="text-xs text-emerald-700 font-medium mt-0.5">done</p>
            </div>
            <div className="w-10 h-10 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center border border-emerald-100">✓</div>
          </div>
          <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-sm flex items-center justify-between">
            <div>
              <p className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">Not Started</p>
              <p className="text-2xl font-bold text-slate-900 mt-1">{notStartedCount}</p>
              <p className="text-xs text-slate-400 mt-0.5">backlog</p>
            </div>
            <div className="w-10 h-10 rounded-lg bg-slate-50 text-slate-500 flex items-center justify-center border border-slate-200">○</div>
          </div>
        </div>

        {/* Filter toolstrip */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 flex-1">
            <div className="relative min-w-[240px] flex-1 max-w-md">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[16px] text-slate-400">⌕</span>
              <input aria-label="search projects" placeholder="Search projects by name, code, owner or tag..." className="w-full h-10 pl-9 pr-3 rounded-lg bg-slate-50 text-sm text-slate-900 placeholder:text-slate-400 outline-none ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-600 focus:bg-white" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <select aria-label="filter by category" className="h-10 px-3 rounded-lg bg-slate-50 text-[13px] border border-slate-200 text-slate-800" value={categoryFilter} onChange={(e) => { setCategoryFilter(e.target.value); if (!showCreate) setCategoryId(e.target.value); fetchProjects(e.target.value || undefined); }}>
              <option value="">All Categories</option>
              {categories.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
            </select>
            <select aria-label="filter by project status" className="h-10 px-3 rounded-lg bg-slate-50 text-[13px] border border-slate-200 text-slate-800" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All Statuses</option>
              {PROJECT_STATUSES.map((s) => (<option key={s} value={s}>{s}</option>))}
            </select>
            <button onClick={resetFilters} className="h-10 px-3 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 text-[13px] flex items-center gap-1.5" type="button">Reset Filters</button>
          </div>
          <span className="text-xs text-slate-400 shrink-0">{filtered.length} of {total} projects</span>
        </div>

        {/* Matrix */}
        <div className="flex flex-col space-y-4">
          <div className="bg-white px-6 py-3.5 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between text-slate-600 text-[13px]">
            <div className="flex items-center gap-3">
              <span className="text-xs text-slate-500 uppercase tracking-wider font-semibold">Projects Matrix // Default Enterprise</span>
              <span className="w-1.5 h-1.5 rounded-full bg-slate-300" />
              <span className="font-semibold text-slate-800">{activeCount} active of {total} total projects</span>
            </div>
            <span className="text-slate-500">Sorted by: <strong className="text-slate-900 font-semibold">Code</strong></span>
          </div>
          <div className="flex flex-col gap-2.5">
            {filtered.map((p) => {
              const pc = p.color || "#6b7280";
              const st = p.project_status || "Active";
              return (
                <div
                  key={p.id}
                  onClick={() => navigate(`/projects/${p.id}/list`)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") navigate(`/projects/${p.id}/list`); }}
                  role="button"
                  tabIndex={0}
                  aria-label={`Open project ${p.name}`}
                  style={{ borderLeftColor: pc }}
                  className="flex items-center gap-4 py-3.5 px-5 bg-white border border-slate-200 border-l-4 rounded-xl shadow-sm hover:border-slate-300 transition-all min-h-[60px] cursor-pointer overflow-x-auto"
                >
                  <div className="w-72 flex-shrink-0 flex flex-col justify-center">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded text-xs font-semibold shrink-0 border" style={{ backgroundColor: `${pc}14`, color: pc, borderColor: `${pc}55` }}>{p.code}</span>
                      <span className="font-semibold text-slate-900 text-sm whitespace-nowrap overflow-hidden text-ellipsis">{p.name}</span>
                    </div>
                    <span className="text-xs text-slate-500 mt-0.5">{p.category_name || "—"} › {p.code}</span>
                  </div>
                  <div className="w-36 flex-shrink-0">
                    <span className={`px-2.5 py-1 rounded-full text-xs font-medium flex items-center gap-1.5 w-fit border ${statusPill(st)}`}>
                      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: statusColor(st) }} /> {st}
                    </span>
                  </div>
                  <div className="w-40 flex-shrink-0 flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-full text-white text-xs flex items-center justify-center font-bold shrink-0" style={{ backgroundColor: pc }}>{initials(p.owner_name)}</div>
                    <div className="flex flex-col min-w-0">
                      <span className="text-xs font-semibold text-slate-900 leading-tight truncate">{p.owner_name || "Unassigned"}</span>
                      <span className="text-[11px] text-slate-500 leading-tight truncate">{p.task_count ?? 0} tasks</span>
                    </div>
                  </div>
                  <div className="w-44 flex-shrink-0 text-xs text-slate-500">
                    Span: {p.start_date || "Not set"}{p.target_date ? ` → ${p.target_date}` : ""}
                  </div>
                  <div className="flex-shrink-0 ml-auto flex items-center gap-1">
                    <span className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400">›</span>
                  </div>
                </div>
              );
            })}
            {filtered.length === 0 && (
              <div className="p-8 bg-white rounded-xl border border-slate-200 text-center text-slate-400 text-sm">No projects found.</div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
