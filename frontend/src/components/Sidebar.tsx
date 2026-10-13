import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../stores/auth";
import { useTheme } from "../stores/theme";
import { projectSwitchPath } from "../utils/taskViewMemory";

interface Category {
  id: number;
  key: string;
  name: string;
  color?: string | null;
  project_count?: number;
}

interface Project {
  id: number;
  code: string;
  name: string;
  category_id?: number | null;
  category_name?: string | null;
  task_count?: number;
  color?: string | null;
  project_status?: string;
}

interface TaskHit {
  id: number;
  project_id: number;
  depth: number;
  title: string;
  wbs?: string;
}

function depthLabel(d: number): string {
  if (d === 1) return "Subtask";
  if (d >= 2) return "Microtask";
  return "Task";
}

export default function Sidebar() {
  const auth = useAuth();
  const { theme } = useTheme();
  // Slate/white sampleproj look (enterprise default + sample) vs legacy tokens.
  // Keeps theme changeable later: add a new VisualTheme branch here.
  const slate = theme !== "legacy";
  const location = useLocation();
  const navigate = useNavigate();

  // URL is source of truth (avoids :id ambiguity between /categories/:id and /projects/:id)
  const pathMatch = location.pathname.match(/^\/projects\/(\d+)/);
  const activeProjectId = pathMatch ? Number(pathMatch[1]) : null;
  const catMatch = location.pathname.match(/^\/categories\/(\d+)/);
  const activeCategoryId = catMatch ? Number(catMatch[1]) : null;

  const [collapsed, setCollapsed] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [projectsByCat, setProjectsByCat] = useState<Record<number, Project[]>>({});
  const [openCats, setOpenCats] = useState<Set<number>>(new Set());
  const [settingsCatId, setSettingsCatId] = useState<number | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [lhsQuery, setLhsQuery] = useState("");
  const [catsCardOpen, setCatsCardOpen] = useState(true);
  const [projsCardOpen, setProjsCardOpen] = useState(true);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [paletteTasks, setPaletteTasks] = useState<TaskHit[]>([]);
  const [paletteLoading, setPaletteLoading] = useState(false);
  const paletteInputRef = useRef<HTMLInputElement>(null);
  const canManage = auth.role === "admin" || auth.role === "manager";

  useEffect(() => {
    if (!auth.accessToken) return;
    fetch("/api/v1/categories", {
      headers: { Authorization: `Bearer ${auth.accessToken}` },
    })
      .then((r) => (r.ok ? r.json() : []))
      .then((cats: Category[]) => {
        setCategories(cats);
        // Expand first category by default (matches prototype)
        if (cats.length > 0) {
          setOpenCats((prev) => (prev.size === 0 ? new Set([cats[0].id]) : prev));
          // Lazy-load projects for each category
          cats.forEach((c) => {
            fetch(`/api/v1/projects?category_id=${c.id}`, {
              headers: { Authorization: `Bearer ${auth.accessToken}` },
            })
              .then((r) => (r.ok ? r.json() : []))
              .then((projs: Project[]) =>
                setProjectsByCat((prev) => ({ ...prev, [c.id]: projs }))
              )
              .catch(() => {});
          });
        }
      })
      .catch(() => setCategories([]));
  }, [auth.accessToken, refreshKey]);

  // ⌘K / Ctrl+K toggles global search palette; Esc closes
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      } else if (e.key === "Escape") {
        setPaletteOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (paletteOpen) {
      setPaletteQuery(lhsQuery);
      window.setTimeout(() => paletteInputRef.current?.focus(), 30);
    }
  }, [paletteOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced global search: Projects client-side + Tasks via API (title/description contains)
  useEffect(() => {
    if (!paletteOpen) return;
    const q = paletteQuery.trim();
    if (!q) {
      setPaletteTasks([]);
      setPaletteLoading(false);
      return;
    }
    setPaletteLoading(true);
    const t = window.setTimeout(() => {
      if (!auth.accessToken) {
        setPaletteLoading(false);
        return;
      }
      fetch(`/api/v1/tasks?search=${encodeURIComponent(q)}`, {
        headers: { Authorization: `Bearer ${auth.accessToken}` },
      })
        .then((r) => (r.ok ? r.json() : []))
        .then((hits: TaskHit[]) => setPaletteTasks(Array.isArray(hits) ? hits.slice(0, 20) : []))
        .catch(() => setPaletteTasks([]))
        .finally(() => setPaletteLoading(false));
    }, 250);
    return () => window.clearTimeout(t);
  }, [paletteQuery, paletteOpen, auth.accessToken]);

  const toggleCat = (id: number) => {
    setOpenCats((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  const allProjects: Project[] = useMemo(() => {
    const out: Project[] = [];
    for (const c of categories) {
      for (const p of projectsByCat[c.id] ?? []) {
        out.push({ ...p, category_id: p.category_id ?? c.id, category_name: p.category_name ?? c.name });
      }
    }
    return out;
  }, [categories, projectsByCat]);

  const totalProjects = useMemo(
    () => categories.reduce((n, c) => n + (c.project_count ?? (projectsByCat[c.id] ?? []).length), 0),
    [categories, projectsByCat]
  );

  const ql = lhsQuery.trim().toLowerCase();
  const filteredCategories = useMemo(() => {
    if (!ql) return categories;
    return categories.filter(
      (c) => c.name.toLowerCase().includes(ql) || c.key.toLowerCase().includes(ql)
    );
  }, [categories, ql]);

  const projsFor = (catId: number): Project[] => {
    const projs = projectsByCat[catId] ?? [];
    if (!ql) return projs;
    const cat = catById.get(catId);
    const catHit =
      cat != null &&
      (cat.name.toLowerCase().includes(ql) || cat.key.toLowerCase().includes(ql));
    if (catHit) return projs;
    return projs.filter(
      (p) => p.name.toLowerCase().includes(ql) || p.code.toLowerCase().includes(ql)
    );
  };

  const catHasActive = (catId: number): boolean =>
    (projectsByCat[catId] ?? []).some((p) => (p.project_status || "Active") === "Active");

  // Flat Projects card: 5 newest Active (id desc ≈ creation order) + Master Hub entry
  const recentProjects: Project[] = useMemo(() => {
    const pq = paletteOpen ? "" : ql;
    let list = allProjects.filter((p) => (p.project_status || "Active") === "Active");
    if (pq) {
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(pq) ||
          p.code.toLowerCase().includes(pq) ||
          (p.category_name ?? "").toLowerCase().includes(pq)
      );
    }
    return [...list].sort((a, b) => b.id - a.id).slice(0, 5);
  }, [allProjects, ql, paletteOpen]);

  const pqTrim = paletteQuery.trim().toLowerCase();
  const paletteProjects: Project[] = useMemo(() => {
    if (!pqTrim) return [];
    return allProjects
      .filter(
        (p) =>
          p.name.toLowerCase().includes(pqTrim) ||
          p.code.toLowerCase().includes(pqTrim) ||
          (p.category_name ?? "").toLowerCase().includes(pqTrim)
      )
      .slice(0, 8);
  }, [allProjects, pqTrim]);

  const projectLabel = (pid: number): string => {
    const p = allProjects.find((x) => x.id === pid);
    if (!p) return `Project ${pid}`;
    return `${p.code} • ${p.category_name ?? ""}`;
  };

  const goProject = (pid: number, highlightTaskId?: number) => {
    setPaletteOpen(false);
    // Task View memory: project jumps keep the current view; task-highlight
    // jumps stay on List (highlight is a List-only feature).
    navigate(
      projectSwitchPath(pid, auth.role, {
        highlightTaskId: highlightTaskId ?? null,
        fromPathname: location.pathname,
      })
    );
  };

  const isSettings = location.pathname.startsWith("/settings");
  const isHelp = location.pathname.startsWith("/help");
  const isCategories = location.pathname.startsWith("/categories");
  const isProjects = location.pathname === "/projects" || location.pathname.startsWith("/projects");

  if (!auth.accessToken) return null;

  return (
    <aside
      className={`sticky top-0 h-screen z-40 flex flex-col justify-between select-none transition-all duration-200 shrink-0 border-r ${
        slate
          ? "bg-white border-slate-200 shadow-[0_1px_3px_rgba(0,0,0,0.05)]"
          : "bg-surface-container-low shadow-sm"
      } ${collapsed ? "w-16" : "w-72"}`}
    >
      <div className="flex flex-col h-full overflow-hidden">
        {/* Brand header (sampleproj: h-16 white + slate-900 logo + version pill) */}
        <div
          className={`flex items-center justify-between shrink-0 ${
            slate ? "h-16 px-4 bg-white border-b border-slate-200/80" : "h-14 px-3 bg-surface-container-low"
          }`}
        >
          <button
            onClick={() => navigate("/projects")}
            className="flex items-center gap-2 min-w-0 text-left"
            title="NEROVATE-PM — go to Projects Directory"
          >
            <span
              className={`w-8 h-8 rounded-lg flex items-center justify-center shadow-sm text-sm shrink-0 ${
                slate ? "bg-slate-900 text-white ring-1 ring-slate-800" : "bg-primary text-on-primary"
              }`}
            >
              ▣
            </span>
            {!collapsed && (
              <span className="flex flex-col min-w-0 leading-none">
                <span
                  className={`tracking-tight truncate font-bold ${
                    slate ? "text-slate-900 text-[15px]" : "text-title-sm font-title-sm text-on-surface"
                  }`}
                >
                  NEROVATE-PM
                </span>
                <span className={`text-[11px] mt-0.5 ${slate ? "text-slate-500" : "text-on-surface-variant"}`}>
                  Enterprise Core
                </span>
              </span>
            )}
          </button>
          <span className="flex items-center gap-2 shrink-0">
            {!collapsed && slate && (
              <span className="text-[11px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-medium border border-slate-200">
                v2.4
              </span>
            )}
            <button
              onClick={() => setCollapsed((c) => !c)}
              className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors shrink-0 ${
                slate
                  ? "text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                  : "text-on-surface-variant hover:bg-surface-container hover:text-on-surface"
              }`}
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {collapsed ? "»" : "«"}
            </button>
          </span>
        </div>

        {/* Search row (sampleproj: slate-50 input + slate-200 ⌘K + slate-900 quick create) */}
        {!collapsed ? (
          <div className="px-3 py-2 shrink-0">
            <div className="flex items-center gap-2">
              <div className="relative flex-1 min-w-0">
                <span
                  className={`absolute left-2.5 top-1/2 -translate-y-1/2 text-[15px] pointer-events-none ${
                    slate ? "text-slate-400" : "text-outline"
                  }`}
                >
                  ⌕
                </span>
                <input
                  aria-label="Filter categories and projects"
                  placeholder="Search task, doc..."
                  value={lhsQuery}
                  onChange={(e) => setLhsQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
                      e.preventDefault();
                      setPaletteOpen(true);
                    }
                  }}
                  className={`w-full h-9 pl-8 pr-10 rounded-lg text-body-sm transition-all focus:outline-none ${
                    slate
                      ? "bg-slate-50 text-slate-900 placeholder:text-slate-400 ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-600 focus:bg-white"
                      : "bg-surface-container-lowest shadow-sm text-on-surface placeholder:text-outline focus:ring-2 focus:ring-primary/20"
                  }`}
                />
                <button
                  onClick={() => setPaletteOpen(true)}
                  title="Global search (Ctrl/⌘+K): Projects, Tasks, Subtasks, Microtasks"
                  className={`absolute right-1.5 top-1/2 -translate-y-1/2 font-code-sm text-[11px] px-1.5 py-0.5 rounded ${
                    slate
                      ? "bg-slate-200/70 text-slate-600 hover:text-slate-900"
                      : "bg-surface-container text-on-surface-variant hover:text-on-surface"
                  }`}
                >
                  ⌘K
                </button>
              </div>
              <button
                onClick={() => navigate("/projects")}
                className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors shrink-0 text-lg leading-none ${
                  slate
                    ? "bg-slate-900 text-white hover:bg-slate-800"
                    : "bg-primary-fixed text-on-primary-fixed hover:bg-primary-fixed-dim"
                }`}
                title="Quick Create — New Project"
              >
                +
              </button>
            </div>
          </div>
        ) : (
          <div className="px-2 py-2 shrink-0 flex justify-center">
            <button
              onClick={() => setPaletteOpen(true)}
              className={`w-8 h-8 rounded-lg flex items-center justify-center shadow-sm ${
                slate
                  ? "bg-white text-slate-500 hover:text-slate-900 border border-slate-200"
                  : "bg-surface-container-lowest text-on-surface-variant hover:text-on-surface"
              }`}
              title="Global search (Ctrl/⌘+K)"
            >
              ⌕
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-3">
          {/* Categories card (sampleproj slate + shaded tile) */}
          {!collapsed && (
            <div
              className={
                slate
                  ? "p-2 bg-slate-50 border border-slate-200 rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.05)] space-y-1.5"
                  : "p-2 bg-primary-fixed/20 border border-primary-fixed rounded-xl shadow-sm space-y-1.5"
              }
            >
              <div className="flex items-center justify-between px-1 py-1">
                <span className="flex items-center gap-1.5 min-w-0">
                  <button
                    onClick={() => setCatsCardOpen((o) => !o)}
                    className={`w-5 h-5 flex items-center justify-center rounded text-xs shrink-0 ${
                      slate
                        ? "text-slate-400 hover:text-slate-700"
                        : "text-on-surface-variant hover:text-on-surface"
                    }`}
                    title={catsCardOpen ? "Collapse Categories menu" : "Expand Categories menu"}
                    aria-expanded={catsCardOpen}
                  >
                    {catsCardOpen ? "▾" : "▸"}
                  </button>
                  <Link to="/categories" className="flex items-center gap-1.5 min-w-0" title="Open Categories Directory">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${slate ? "bg-blue-600" : "bg-tertiary"}`} />
                  <span
                    className={`text-[11px] font-bold uppercase tracking-wider ${
                      slate ? "text-slate-400" : "text-on-surface"
                    }`}
                  >
                    Categories
                  </span>
                  <span
                    className={`text-[11px] px-1.5 py-0.5 rounded-full font-semibold ${
                      slate
                        ? "bg-slate-100 text-slate-600 border border-slate-200"
                        : "bg-surface-container text-on-surface-variant"
                    }`}
                  >
                    {categories.length}
                  </span>
                </Link>
                <div className="flex items-center gap-0.5">
                  {canManage && (
                    <button
                      onClick={() => navigate("/categories")}
                      className={`w-5 h-5 flex items-center justify-center rounded transition-colors ${
                        slate ? "text-slate-400 hover:text-slate-700 hover:bg-slate-100" : "text-outline hover:text-on-surface"
                      }`}
                      title="Add Category"
                    >
                      +
                    </button>
                  )}
                  <button
                    onClick={() => navigate("/settings")}
                    className={`w-5 h-5 flex items-center justify-center rounded transition-colors text-xs ${
                      slate ? "text-slate-400 hover:text-slate-700 hover:bg-slate-100" : "text-outline hover:text-on-surface"
                    }`}
                    title="Category Settings"
                  >
                    ⚙
                  </button>
                </div>
                </span>
              </div>
              <nav className="space-y-1" aria-label="Categories">
                {catsCardOpen && filteredCategories.map((c) => {
                  const open = ql ? true : openCats.has(c.id);
                  const projs = projsFor(c.id);
                  const containsActive = activeProjectId != null && projs.some((p) => p.id === activeProjectId);
                  const isCatActive = activeCategoryId === c.id;
                  return (
                    <div key={c.id} className="space-y-0.5 rounded-lg">
                      <div
                        className={`flex items-center justify-between px-2 py-2 rounded-lg transition-all relative overflow-hidden ${
                          slate
                            ? isCatActive
                              ? "bg-slate-900 text-white font-semibold shadow-sm"
                              : open || containsActive
                                ? "bg-white text-slate-900 font-semibold border border-slate-200"
                                : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 font-medium"
                            : open || containsActive || isCatActive
                              ? "bg-surface-container-low text-on-surface font-semibold"
                              : "text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface"
                        }`}
                      >
                        {slate && isCatActive && (
                          <span className="w-1 h-5 bg-blue-500 rounded-r absolute left-0 top-1/2 -translate-y-1/2" />
                        )}
                        <span className="flex items-center gap-1.5 min-w-0">
                          <button
                            onClick={() => toggleCat(c.id)}
                            className="w-5 h-5 flex items-center justify-center rounded text-xs shrink-0"
                            title={open ? `Collapse ${c.name}` : `Expand ${c.name}`}
                            aria-expanded={open}
                          >
                            {open ? "▾" : "▸"}
                          </button>
                          <span
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ background: c.color || "#6b7280" }}
                          />
                          <Link
                            to={`/categories/${c.id}`}
                            className="text-[13px] truncate hover:underline"
                            title={`${c.name} — open category`}
                          >
                            {c.name}
                          </Link>
                          {catHasActive(c.id) && (
                            <span
                              className={`text-[10px] px-1 rounded font-bold shrink-0 ${
                                slate
                                  ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                                  : "bg-tertiary-fixed text-on-tertiary-fixed"
                              }`}
                            >
                              ACTIVE
                            </span>
                          )}
                        </span>
                        <span className="flex items-center gap-1 shrink-0">
                          <Link
                            to={`/projects?category_id=${c.id}`}
                            className={`text-[11px] px-1.5 py-0.5 rounded-full font-semibold ${
                              slate
                                ? "bg-slate-100 text-slate-600 border border-slate-200 hover:text-slate-900"
                                : "bg-surface-container text-on-surface-variant hover:text-on-surface"
                            }`}
                            title={`View all ${c.name} projects in Projects Directory`}
                          >
                            {c.project_count ?? (projectsByCat[c.id] ?? []).length}
                          </Link>
                          {canManage && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setSettingsCatId(c.id);
                              }}
                              className={`w-5 h-5 rounded flex items-center justify-center text-[11px] ${
                                slate
                                  ? "text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                                  : "text-on-surface-variant hover:text-on-surface hover:bg-surface-container"
                              }`}
                              title={`Category settings — ${c.name}`}
                            >
                              ⚙
                            </button>
                          )}
                        </span>
                      </div>
                      {open && (
                        <div className="pl-4 space-y-0.5">
                          {projs.map((p) => {
                            const selected = activeProjectId === p.id;
                            return (
                              <Link
                                key={p.id}
                                to={projectSwitchPath(p.id, auth.role, { fromPathname: location.pathname })}
                                aria-current={selected ? "page" : undefined}
                                className={`flex items-center justify-between px-2 py-2 rounded-lg transition-all text-[12px] relative overflow-hidden ${
                                  slate
                                    ? selected
                                      ? "bg-slate-900 text-white font-semibold shadow-sm"
                                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 font-medium"
                                    : selected
                                      ? "bg-primary-fixed text-on-primary-fixed font-semibold shadow-sm"
                                      : "text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface"
                                }`}
                              >
                                {slate && selected && (
                                  <span className="w-1 h-5 bg-blue-500 rounded-r absolute left-0 top-1/2 -translate-y-1/2" />
                                )}
                                <span className="flex items-center gap-2 min-w-0 ml-1">
                                  <span className={`text-xs ${slate ? "text-slate-400" : "text-outline"}`}>↳</span>
                                  <span className={`truncate ${selected ? "font-bold" : ""}`}>{p.name}</span>
                                  {selected && (
                                    <span
                                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                        slate ? "bg-blue-500" : "bg-primary"
                                      }`}
                                    />
                                  )}
                                </span>
                                {p.task_count !== undefined && (
                                  <span
                                    className={`text-[11px] px-1.5 py-0.5 rounded-full font-bold shrink-0 ${
                                      slate
                                        ? selected
                                          ? "bg-white/20 text-white"
                                          : "text-slate-400"
                                        : selected
                                          ? "bg-white/70 text-on-primary-fixed"
                                          : "text-outline"
                                    }`}
                                  >
                                    {p.task_count}
                                  </span>
                                )}
                              </Link>
                            );
                          })}
                          {projs.length === 0 && (
                            <div className="px-2 py-1 text-[12px] text-on-surface-variant">No projects</div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
                {catsCardOpen && filteredCategories.length === 0 && (
                  <div className="px-2 py-3 text-[12px] text-outline text-center">
                    {categories.length === 0 ? (
                      <span>
                        No categories —{" "}
                        <button className="underline text-primary" onClick={() => navigate("/categories")}>
                          browse
                        </button>
                      </span>
                    ) : (
                      "No matches in sidebar."
                    )}
                  </div>
                )}
              </nav>
            </div>
          )}

          {/* Projects card (sampleproj slate + shaded tile + Master Hub) */}
          {!collapsed && (
            <div
              className={
                slate
                  ? "p-2 bg-slate-50 border border-slate-200 rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.05)] space-y-1.5"
                  : "p-2 bg-secondary-fixed/20 border border-secondary-fixed rounded-xl shadow-sm space-y-1.5"
              }
            >
              <div className="flex items-center justify-between px-1 py-1">
                <span className="flex items-center gap-1.5 min-w-0">
                  <button
                    onClick={() => setProjsCardOpen((o) => !o)}
                    className={`w-5 h-5 flex items-center justify-center rounded text-xs shrink-0 ${
                      slate ? "text-slate-400 hover:text-slate-700" : "text-on-surface-variant hover:text-on-surface"
                    }`}
                    title={projsCardOpen ? "Collapse Projects menu" : "Expand Projects menu"}
                    aria-expanded={projsCardOpen}
                  >
                    {projsCardOpen ? "▾" : "▸"}
                  </button>
                  <Link to="/projects" className="flex items-center gap-1.5 min-w-0" title="Open Projects Directory">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${slate ? "bg-slate-900" : "bg-secondary-container"}`} />
                  <span
                    className={`text-[11px] font-bold uppercase tracking-wider ${
                      slate ? "text-slate-400" : "text-on-surface"
                    }`}
                  >
                    Projects
                  </span>
                  <span
                    className={`text-[11px] px-1.5 py-0.5 rounded-full font-semibold ${
                      slate
                        ? "bg-slate-100 text-slate-600 border border-slate-200"
                        : "bg-surface-container text-on-surface-variant"
                    }`}
                  >
                    {totalProjects}
                  </span>
                </Link>
                <div className="flex items-center gap-0.5">
                  {canManage && (
                    <button
                      onClick={() => navigate("/projects")}
                      className={`w-5 h-5 flex items-center justify-center rounded transition-colors ${
                        slate ? "text-slate-400 hover:text-slate-700 hover:bg-slate-100" : "text-outline hover:text-on-surface"
                      }`}
                      title="Add Project"
                    >
                      +
                    </button>
                  )}
                  <button
                    onClick={() => navigate("/projects")}
                    className={`w-5 h-5 flex items-center justify-center rounded transition-colors text-xs ${
                      slate ? "text-slate-400 hover:text-slate-700 hover:bg-slate-100" : "text-outline hover:text-on-surface"
                    }`}
                    title="Filter Projects"
                  >
                    ☰
                  </button>
                </div>
                </span>
              </div>
              <nav className="space-y-1" aria-label="Projects">
                {projsCardOpen && (
                <Link
                  to="/projects"
                  className={`flex items-center justify-between px-2 py-2 rounded-lg transition-all text-[13px] relative overflow-hidden ${
                    slate
                      ? location.pathname === "/projects"
                        ? "bg-slate-900 text-white font-semibold shadow-sm"
                        : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 font-medium"
                      : location.pathname === "/projects"
                        ? "bg-surface-container-low text-on-surface font-semibold"
                        : "text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface"
                  }`}
                >
                  {slate && location.pathname === "/projects" && (
                    <span className="w-1 h-5 bg-blue-500 rounded-r absolute left-0 top-1/2 -translate-y-1/2" />
                  )}
                  <span className="flex items-center gap-2 min-w-0 ml-1">
                    <span className={slate ? "text-slate-400" : "text-outline"}>▤</span>
                    <span>Master Hub (All)</span>
                  </span>
                  <span className={`text-[11px] ${slate ? "text-slate-400" : "text-outline"}`}>{totalProjects}</span>
                </Link>
                )}
                {projsCardOpen && recentProjects.map((p) => {
                  const selected = activeProjectId === p.id;
                  const dot = p.color || catById.get(p.category_id ?? -1)?.color || "#6b7280";
                  return (
                    <Link
                      key={p.id}
                      to={projectSwitchPath(p.id, auth.role, { fromPathname: location.pathname })}
                      aria-current={selected ? "page" : undefined}
                      title={p.code ? `${p.code} — ${p.name}` : p.name}
                      className={`flex items-center justify-between px-2 py-2 rounded-lg transition-all relative overflow-hidden ${
                        slate
                          ? selected
                            ? "bg-slate-900 text-white shadow-sm"
                            : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                          : selected
                            ? "bg-primary-fixed text-on-primary-fixed shadow-sm"
                            : "text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface"
                      }`}
                    >
                      {slate && selected && (
                        <span className="w-1 h-5 bg-blue-500 rounded-r absolute left-0 top-1/2 -translate-y-1/2" />
                      )}
                      <span className="flex items-center gap-2 min-w-0 ml-1">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: dot }} />
                        <span className={`text-[13px] truncate ${selected ? "font-bold" : ""}`}>{p.name}</span>
                      </span>
                      {p.task_count !== undefined && (
                        <span
                          className={`text-[11px] px-1.5 py-0.5 rounded-full font-bold shrink-0 ${
                            slate
                              ? selected
                                ? "bg-white/20 text-white"
                                : "bg-slate-100 text-slate-500 border border-slate-200"
                              : selected
                                ? "bg-white/70 text-on-primary-fixed"
                                : "bg-surface-container text-on-surface-variant"
                          }`}
                        >
                          {p.task_count}
                        </span>
                      )}
                    </Link>
                  );
                })}
                {projsCardOpen && recentProjects.length === 0 && (
                  <div className="px-2 py-2 text-[12px] text-outline text-center">No active projects{ql ? " match." : "."}</div>
                )}
              </nav>
            </div>
          )}

          {/* Collapsed affordances (sampleproj slate) */}
          {collapsed && (
            <div className="space-y-2 flex flex-col items-center">
              <button
                onClick={() => navigate("/categories")}
                className={`w-9 h-9 rounded-lg flex items-center justify-center text-sm ${
                  slate
                    ? isCategories
                      ? "bg-slate-900 text-white"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                    : isCategories
                      ? "bg-surface-container text-on-surface"
                      : "text-on-surface-variant hover:bg-surface-container-low"
                }`}
                title="Categories Directory"
              >
                ▦
              </button>
              <button
                onClick={() => navigate("/projects")}
                className={`w-9 h-9 rounded-lg flex items-center justify-center text-sm ${
                  slate
                    ? isProjects && activeProjectId == null
                      ? "bg-slate-900 text-white"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                    : isProjects && activeProjectId == null
                      ? "bg-surface-container text-on-surface"
                      : "text-on-surface-variant hover:bg-surface-container-low"
                }`}
                title="Projects Directory"
              >
                ▤
              </button>
              {allProjects.slice(0, 5).map((p) => (
                <button
                  key={p.id}
                  onClick={() => navigate(projectSwitchPath(p.id, auth.role, { fromPathname: location.pathname }))}
                  className={`w-9 h-9 rounded-lg flex items-center justify-center text-[11px] font-bold truncate ${
                    slate
                      ? activeProjectId === p.id
                        ? "bg-slate-900 text-white"
                        : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                      : activeProjectId === p.id
                        ? "bg-primary-fixed text-on-primary-fixed"
                        : "text-on-surface-variant hover:bg-surface-container-low"
                  }`}
                  title={`${p.code} — ${p.name}`}
                >
                  {p.code.slice(0, 2)}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className={`p-3 shrink-0 space-y-1 ${slate ? "bg-white border-t border-slate-200" : "bg-surface-container-low"}`}>
        <Link
          to="/settings"
          className={`flex items-center ${collapsed ? "justify-center" : "justify-between"} px-2 py-2 rounded-lg transition-all font-medium ${
            slate
              ? isSettings
                ? "bg-slate-900 text-white font-semibold shadow-sm"
                : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              : isSettings
                ? "bg-surface-container text-on-surface font-medium"
                : "text-on-surface-variant hover:bg-surface-container hover:text-on-surface"
          }`}
          title="Global Settings"
        >
          <span className="flex items-center gap-3">
            <span>⚙</span>
            {!collapsed && <span className="text-[13px]">Global Settings</span>}
          </span>
          {!collapsed && <span className={`w-2 h-2 rounded-full ${slate ? "bg-blue-500" : "bg-primary-container"}`} />}
        </Link>
        <Link
          to="/help"
          className={`flex items-center ${collapsed ? "justify-center" : "justify-between"} px-2 py-2 rounded-lg transition-all font-medium ${
            slate
              ? isHelp
                ? "bg-slate-900 text-white font-semibold shadow-sm"
                : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              : isHelp
                ? "bg-surface-container text-on-surface font-medium"
                : "text-on-surface-variant hover:bg-surface-container hover:text-on-surface"
          }`}
          title="Help & Documentation"
        >
          <span className="flex items-center gap-3">
            <span>?</span>
            {!collapsed && <span className="text-[13px]">Help &amp; Documentation</span>}
          </span>
          {!collapsed && <span className={`text-xs ${slate ? "text-slate-400" : "text-outline"}`}>↗</span>}
        </Link>
      </div>
      {settingsCatId != null && (
        <CategorySettingsModal
          categoryId={settingsCatId}
          onClose={() => setSettingsCatId(null)}
          onUpdated={() => setRefreshKey((k) => k + 1)}
        />
      )}
      {paletteOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-20"
          role="dialog"
          aria-modal="true"
          aria-label="Global search"
          onClick={() => setPaletteOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-xl bg-surface-container-lowest shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-subtle">
              <input
                ref={paletteInputRef}
                aria-label="Global search projects tasks subtasks microtasks"
                placeholder="Search Projects, Tasks, Subtasks, Microtasks..."
                value={paletteQuery}
                onChange={(e) => setPaletteQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    if (paletteProjects.length > 0) goProject(paletteProjects[0].id);
                    else if (paletteTasks.length > 0) goProject(paletteTasks[0].project_id, paletteTasks[0].id);
                  }
                }}
                className="w-full px-3 py-2 rounded-lg bg-surface-container text-sm text-on-surface placeholder:text-outline focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              <p className="mt-1.5 text-[11px] text-outline">
                Project name, Task / Subtask / Microtask title — Enter opens first hit, Esc closes.
              </p>
            </div>
            <div className="p-2 max-h-[60vh] overflow-y-auto">
              {paletteLoading && <p className="px-3 py-3 text-xs text-on-surface-variant">Searching…</p>}
              {!paletteLoading && !pqTrim && (
                <p className="px-3 py-3 text-xs text-outline">Type to search across all visible Projects and Tasks.</p>
              )}
              {paletteProjects.length > 0 && (
                <div className="mb-1">
                  <p className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
                    Projects
                  </p>
                  {paletteProjects.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => goProject(p.id)}
                      className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-left hover:bg-surface-container-low"
                    >
                      <span className="min-w-0">
                        <span className="block text-[13px] font-medium text-on-surface truncate">{p.name}</span>
                        <span className="block font-code-sm text-[11px] text-outline">
                          {p.code} • {p.category_name ?? ""}
                        </span>
                      </span>
                      <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-surface-container text-on-surface-variant shrink-0">
                        Project
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {paletteTasks.length > 0 && (
                <div>
                  <p className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
                    Tasks / Subtasks / Microtasks
                  </p>
                  {paletteTasks.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => goProject(t.project_id, t.id)}
                      className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-left hover:bg-surface-container-low"
                    >
                      <span className="min-w-0">
                        <span className="block text-[13px] text-on-surface truncate">{t.title}</span>
                        <span className="block font-code-sm text-[11px] text-outline">
                          {projectLabel(t.project_id)}{t.wbs ? ` • ${t.wbs}` : ""}
                        </span>
                      </span>
                      <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-surface-container text-on-surface-variant shrink-0">
                        {depthLabel(t.depth)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {!paletteLoading && pqTrim && paletteProjects.length === 0 && paletteTasks.length === 0 && (
                <p className="px-3 py-4 text-xs text-outline text-center">No matches.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}

interface CategoryDetail {
  id: number;
  key: string;
  name: string;
  color: string;
  status_profile_id?: number | null;
  profile_name?: string | null;
}

interface StatusProfile {
  id: number;
  name: string;
}

interface ProfileStage {
  id: number;
  name: string;
  order: number;
  color_base: string;
}

interface ProfileStatus {
  id: number;
  stage_id?: number | null;
  name: string;
  color: string;
  shade?: string | null;
  order: number;
  is_done?: boolean;
}

const CATEGORY_COLORS = ["#6b7280", "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#06b6d4"];

/** Compact per-category settings: rename + link status profile + read status list. */
function CategorySettingsModal({
  categoryId,
  onClose,
  onUpdated,
}: {
  categoryId: number;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const auth = useAuth();
  const [cat, setCat] = useState<CategoryDetail | null>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState("#6b7280");
  const [profiles, setProfiles] = useState<StatusProfile[]>([]);
  const [profileId, setProfileId] = useState("");
  const [stages, setStages] = useState<ProfileStage[]>([]);
  const [statuses, setStatuses] = useState<ProfileStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!auth.accessToken) return;
    let cancelled = false;
    setLoading(true);
    const headers = { Authorization: `Bearer ${auth.accessToken}` };
    (async () => {
      try {
        const [c, all] = await Promise.all([
          fetch(`/api/v1/categories/${categoryId}`, { headers }).then((r) => (r.ok ? r.json() : null)),
          fetch(`/api/v1/status-profiles`, { headers }).then((r) => (r.ok ? r.json() : [])),
        ]);
        if (cancelled) return;
        if (c) {
          setCat(c);
          setName(c.name);
          setColor(c.color || "#6b7280");
          setProfileId(c.status_profile_id ? String(c.status_profile_id) : "");
          if (c.status_profile_id) {
            const [st, ss] = await Promise.all([
              fetch(`/api/v1/status-profiles/${c.status_profile_id}/stages`, { headers }).then((r) =>
                r.ok ? r.json() : []
              ),
              fetch(`/api/v1/status-profiles/${c.status_profile_id}/statuses`, { headers }).then((r) =>
                r.ok ? r.json() : []
              ),
            ]);
            if (cancelled) return;
            setStages(Array.isArray(st) ? st : []);
            setStatuses(Array.isArray(ss) ? ss : []);
          }
        }
        setProfiles(
          (Array.isArray(all) ? all : []).map((p: { id: number; name: string }) => ({ id: p.id, name: p.name }))
        );
      } catch {
        if (!cancelled) setError("Failed to load category settings");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [auth.accessToken, categoryId]);

  const saveName = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth.accessToken) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Name required");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const r = await fetch(`/api/v1/categories/${categoryId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth.accessToken}` },
        body: JSON.stringify({ name: trimmed, color }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || "Save failed");
      const updated: CategoryDetail = await r.json();
      setCat(updated);
      onUpdated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const linkProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth.accessToken || !profileId) return;
    setLinking(true);
    setError("");
    try {
      const r = await fetch(`/api/v1/categories/${categoryId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth.accessToken}` },
        body: JSON.stringify({ status_profile_id: Number(profileId) }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || "Failed to link profile");
      const updated: CategoryDetail = await r.json();
      setCat(updated);
      const headers = { Authorization: `Bearer ${auth.accessToken}` };
      const [st, ss] = await Promise.all([
        fetch(`/api/v1/status-profiles/${profileId}/stages`, { headers }).then((x) => (x.ok ? x.json() : [])),
        fetch(`/api/v1/status-profiles/${profileId}/statuses`, { headers }).then((x) => (x.ok ? x.json() : [])),
      ]);
      setStages(Array.isArray(st) ? st : []);
      setStatuses(Array.isArray(ss) ? ss : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to link profile");
    } finally {
      setLinking(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Category settings${cat ? ` — ${cat.name}` : ""}`}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-subtle bg-surface-container-lowest shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-subtle flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-on-surface truncate">
              ⚙ {cat ? cat.name : "Category settings"}
            </h2>
            {cat && (
              <p className="text-[11px] text-on-surface-variant font-mono">
                Key {cat.key} · ID {cat.id}
                {cat.profile_name ? ` · Profile ${cat.profile_name}` : ""}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-on-surface-variant hover:text-on-surface hover:bg-surface-container"
            title="Close (Esc)"
          >
            ✕
          </button>
        </div>

        <div className="p-4 space-y-4 max-h-[70vh] overflow-y-auto">
          {loading && <p className="text-xs text-on-surface-variant">Loading…</p>}
          {error && (
            <div role="alert" className="text-xs text-error">
              {error}
            </div>
          )}
          {!loading && cat && (
            <>
              <form onSubmit={saveName} className="space-y-3">
                <div>
                  <label className="block text-xs text-on-surface-variant mb-1">Category name *</label>
                  <input
                    required
                    maxLength={80}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-surface-container text-sm border border-subtle text-on-surface"
                  />
                </div>
                <div>
                  <label className="block text-xs text-on-surface-variant mb-1">Color</label>
                  <div className="flex flex-wrap gap-1.5">
                    {CATEGORY_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setColor(c)}
                        title={c}
                        className={`w-6 h-6 rounded border ${color === c ? "ring-2 ring-primary ring-offset-2 ring-offset-surface" : "border-subtle"}`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-4 py-1.5 bg-primary-container hover:bg-primary rounded-lg text-xs font-medium text-on-primary disabled:opacity-50"
                  >
                    {saving ? "Saving…" : "Save"}
                  </button>
                  <button
                    type="button"
                    onClick={onClose}
                    className="px-4 py-1.5 rounded-lg border border-subtle text-xs text-on-surface-variant hover:text-on-surface"
                  >
                    Cancel
                  </button>
                </div>
              </form>

              <div className="rounded-lg border border-subtle bg-surface-container-low/60 p-3">
                <h3 className="text-xs font-semibold text-on-surface uppercase tracking-wider mb-2">
                  Status list (profile)
                </h3>
                <form onSubmit={linkProfile} className="flex gap-2 mb-2">
                  <select
                    aria-label="status profile"
                    value={profileId}
                    onChange={(e) => setProfileId(e.target.value)}
                    className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg bg-surface-container text-xs border border-subtle text-on-surface"
                  >
                    <option value="">Select profile…</option>
                    {profiles.map((p) => (
                      <option key={p.id} value={String(p.id)}>
                        #{p.id} {p.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="submit"
                    disabled={linking || !profileId}
                    className="px-3 py-1.5 bg-primary-container hover:bg-primary rounded-lg text-xs font-medium text-on-primary disabled:opacity-50 shrink-0"
                  >
                    {linking ? "Linking…" : "Link"}
                  </button>
                </form>
                {profileId ? (
                  <div className="space-y-2">
                    {stages.map((st) => (
                      <div key={st.id} className="rounded border border-subtle bg-surface-container-lowest px-2.5 py-1.5">
                        <div className="flex items-center gap-1.5 text-xs font-medium text-on-surface">
                          <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: st.color_base }} />
                          {st.name}
                        </div>
                        <ul className="mt-1 space-y-0.5">
                          {statuses
                            .filter((s) => s.stage_id === st.id)
                            .map((s) => (
                              <li key={s.id} className="flex items-center bg-surface-container px-2 py-0.5 rounded text-[11px] text-on-surface">
                                <span
                                  className="inline-block w-2 h-2 rounded-full mr-1.5"
                                  style={{ backgroundColor: s.shade || s.color }}
                                />
                                {s.name}
                                {s.is_done && <span className="ml-1 text-tertiary">· done</span>}
                              </li>
                            ))}
                        </ul>
                      </div>
                    ))}
                    {statuses
                      .filter((s) => !s.stage_id)
                      .map((s) => (
                        <div key={s.id} className="flex items-center bg-surface-container px-2.5 py-1 rounded text-[11px] text-on-surface">
                          <span
                            className="inline-block w-2 h-2 rounded-full mr-1.5"
                            style={{ backgroundColor: s.shade || s.color }}
                          />
                          {s.name}
                          {s.is_done && <span className="ml-1 text-tertiary">· done</span>}
                        </div>
                      ))}
                    {stages.length === 0 && statuses.length === 0 && (
                      <p className="text-[11px] text-outline">No stages/statuses yet.</p>
                    )}
                  </div>
                ) : (
                  <p className="text-[11px] text-outline">No profile linked — select one above.</p>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function useSidebarOffset(): string {
  return "pl-72";
}
