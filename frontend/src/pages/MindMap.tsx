import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import { useAuth } from "../stores/auth";
import TaskDrawer from "../components/TaskDrawer";
import TaskDialog from "../components/TaskDialog";
import { buildStatusSignalMap } from "../utils/statusSignals";
import {
  ancestorKeys,
  buildMindMapForest,
  connectorPath,
  depthLabel,
  levelShade,
  maxLevelForDepth,
  normalizeHex,
  type MindMapDepth,
  type MindMapLayout,
  type MindNode,
} from "../utils/mindMap";
import { layoutForest } from "../utils/mindMap";

interface ApiTask {
  id: number;
  project_id: number;
  parent_id?: number | null;
  depth: number;
  title: string;
  status_id: number;
  assignee_ids?: number[];
  due_date?: string | null;
  is_blocked?: boolean;
}

interface ApiProject {
  id: number;
  code: string;
  name: string;
  color?: string | null;
  category_id?: number | null;
  status_profile_id?: number | null;
}

interface ApiCategory {
  id: number;
  key: string;
  name: string;
  color: string;
  status_profile_id?: number | null;
}

interface StatusInfo {
  id: number;
  name: string;
  order: number;
  stage_id?: number | null;
  kind?: string;
  is_done?: boolean;
  is_milestone?: boolean;
  shade?: string | null;
  color?: string;
}

interface StageInfo {
  id: number;
  name: string;
  order: number;
  color_base: string;
}

const DEPTHS: MindMapDepth[] = ["overview", "tasks", "subtasks", "full"];
const NODE_W = 280;

function scopeKey(prefix: string, scope: string): string {
  return `nv_mindmap_${prefix}_${scope}`;
}

/**
 * Mind Map View — Category + Project modes in one component
 * (same dual-mode pattern as StatusView/Kanban).
 * - /projects/:id/mindmap → Project root, full hierarchy available
 * - /categories/:id/mindmap → Category root, all Projects in Category
 * - Task/Sub/Micro selection resolves to parent Project scope is handled
 *   by callers linking here; inside the map, clicking a node never narrows scope.
 */
export default function MindMap() {
  const auth = useAuth();
  const { id } = useParams();
  const location = useLocation();
  const isCategoryMode = location.pathname.startsWith("/categories/");
  const scopeId = Number(id);
  const scope = `${isCategoryMode ? "cat" : "proj"}:${scopeId}`;

  const [category, setCategory] = useState<ApiCategory | null>(null);
  const [projects, setProjects] = useState<ApiProject[]>([]);
  const [tasks, setTasks] = useState<ApiTask[]>([]);
  const [statuses, setStatuses] = useState<StatusInfo[]>([]);
  const [stages, setStages] = useState<StageInfo[]>([]);
  const [scopeName, setScopeName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  const [depth, setDepth] = useState<MindMapDepth>(() => {
    try {
      const v = localStorage.getItem(scopeKey("depth", `${isCategoryMode ? "cat" : "proj"}`));
      if (v === "overview" || v === "tasks" || v === "subtasks" || v === "full") return v;
    } catch { /* ignore */ }
    return isCategoryMode ? "tasks" : "overview";
  });
  const [layout, setLayout] = useState<MindMapLayout>(() => {
    try {
      const v = localStorage.getItem(scopeKey("layout", "global"));
      if (v === "vertical") return "vertical";
    } catch { /* ignore */ }
    return "horizontal";
  });
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // Per-branch absolute max-level overrides (Depth Badges). Non-empty => Selector shows Custom (mixed).
  const [branchCaps, setBranchCaps] = useState<Map<string, number>>(new Map());
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [query, setQuery] = useState("");
  const [matchIdx, setMatchIdx] = useState(0);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [showTip, setShowTip] = useState(false);
  const [ctx, setCtx] = useState<{ x: number; y: number; key: string } | null>(null);
  const [drawer, setDrawer] = useState<{ id: number; projectId: number } | null>(null);
  const [edit, setEdit] = useState<{ id: number; projectId: number } | null>(null);
  const [create, setCreate] = useState<{ projectId: number; parentId: number | null; kind: "Task" | "Subtask" | "Microtask" } | null>(null);
  const [statusSaving, setStatusSaving] = useState(false);

  const viewportRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(60);
  const [ty, setTy] = useState(40);
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number; btn: number; moved?: boolean } | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(scopeKey("depth", isCategoryMode ? "cat" : "proj"), depth);
    } catch { /* ignore */ }
  }, [depth, isCategoryMode]);
  useEffect(() => {
    try {
      localStorage.setItem(scopeKey("layout", "global"), layout);
    } catch { /* ignore */ }
  }, [layout]);

  // Reset pan/zoom + selection on scope change, then fit.
  useEffect(() => {
    setTx(60);
    setTy(40);
    setScale(1);
    setSelectedKey(null);
    setCollapsed(new Set());
    setBranchCaps(new Map());
    setCtx(null);
  }, [scope]);

  useEffect(() => {
    if (!auth.accessToken || !scopeId) return;
    setLoading(true);
    setError("");
    const headers = { Authorization: `Bearer ${auth.accessToken}` };
    const load = async () => {
      try {
        let profileId: number | null = null;
        if (isCategoryMode) {
          const [cat, projs]: [ApiCategory | null, ApiProject[]] = await Promise.all([
            fetch(`/api/v1/categories/${scopeId}`, { headers }).then((r) => (r.ok ? r.json() : null)),
            fetch(`/api/v1/categories/${scopeId}/projects`, { headers }).then((r) => (r.ok ? r.json() : [])),
          ]);
          if (!cat) throw new Error(`Category ${scopeId} not found`);
          setCategory(cat);
          setProjects(projs ?? []);
          setScopeName(cat.name);
          profileId = cat.status_profile_id ?? null;
          const rows: ApiTask[] = await fetch(`/api/v1/tasks?category_id=${scopeId}`, { headers }).then((r) => {
            if (!r.ok) throw new Error(`Mind map failed: ${r.status}`);
            return r.json();
          });
          setTasks(rows ?? []);
          if ((projs ?? []).length > 0 && (rows ?? []).length > 0 && !selectedKey) {
            setSelectedKey(`cat:${cat.id}`);
          }
        } else {
          const proj: ApiProject | null = await fetch(`/api/v1/projects/${scopeId}`, { headers }).then((r) =>
            r.ok ? r.json() : null
          );
          if (!proj) throw new Error(`Project ${scopeId} not found`);
          setProjects([proj]);
          setScopeName(`${proj.code} · ${proj.name}`);
          profileId = proj.status_profile_id ?? null;
          let catColor: ApiCategory | null = null;
          if (!profileId && proj.category_id) {
            catColor = await fetch(`/api/v1/categories/${proj.category_id}`, { headers }).then((r) =>
              r.ok ? r.json() : null
            );
            setCategory(catColor);
            profileId = catColor?.status_profile_id ?? null;
          }
          const rows: ApiTask[] = await fetch(`/api/v1/tasks?project_id=${scopeId}`, { headers }).then((r) => {
            if (!r.ok) throw new Error(`Mind map failed: ${r.status}`);
            return r.json();
          });
          setTasks(rows ?? []);
          if (!selectedKey) setSelectedKey(`proj:${proj.id}`);
        }
        if (profileId) {
          const sp = await fetch(`/api/v1/status-profiles/${profileId}`, { headers }).then((r) =>
            r.ok ? r.json() : null
          );
          setStatuses((sp?.statuses ?? []).slice().sort((a: StatusInfo, b: StatusInfo) => (a.order ?? 0) - (b.order ?? 0)));
          setStages(sp?.stages ?? []);
        } else {
          setStatuses([]);
          setStages([]);
        }
        setLoading(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load mind map");
        setLoading(false);
      }
    };
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.accessToken, scopeId, isCategoryMode, refreshKey]);

  const statusById = useMemo(() => new Map(statuses.map((s) => [s.id, s])), [statuses]);
  const stageById = useMemo(() => new Map(stages.map((s) => [s.id, s])), [stages]);
  const signals = useMemo(() => buildStatusSignalMap(statuses), [statuses]);
  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  const rootType = isCategoryMode ? "category" : "project";
  const forest = useMemo(
    () =>
      buildMindMapForest({
        rootType,
        category: category ? { id: category.id, name: category.name, color: category.color } : undefined,
        projects: projects.map((p) => ({ id: p.id, code: p.code, name: p.name, color: p.color })),
        tasks: tasks.map((t) => ({
          id: t.id,
          project_id: t.project_id,
          parent_id: t.parent_id ?? null,
          depth: t.depth,
          title: t.title,
          status_id: t.status_id,
          assignee_ids: t.assignee_ids ?? [],
          due_date: t.due_date ?? null,
          is_blocked: !!t.is_blocked,
        })),
      }),
    [rootType, category, projects, tasks]
  );

  // Filtered set (status filter) → dimmed structural ancestors preserved.
  const filterMatches = useMemo(() => {
    if (!statusFilter) return null;
    const sid = Number(statusFilter);
    const out = new Set<string>();
    for (const n of forest.nodes) {
      if (n.statusId === sid) out.add(n.key);
    }
    return out;
  }, [statusFilter, forest]);

  const searchMatches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return forest.nodes
      .filter((n) => n.name.toLowerCase().includes(q) || (n.code ?? "").toLowerCase().includes(q))
      .map((n) => n.key);
  }, [query, forest]);

  const maxLevel = maxLevelForDepth(depth, rootType);
  const hasCustomDepth = branchCaps.size > 0;
  const visibleDepths = isCategoryMode ? DEPTHS : DEPTHS.filter((d) => d !== "tasks");
  // Legacy persisted "tasks" on Project root duplicates Overview; normalize for display.
  const depthValue = hasCustomDepth ? "custom" : (!isCategoryMode && depth === "tasks" ? "overview" : depth);
  const { placed, bounds } = useMemo(
    () =>
      layoutForest({
        forest,
        layout,
        maxLevel,
        collapsed,
        selectedKey,
        matches: filterMatches ?? undefined,
        branchCaps,
      }),
    [forest, layout, maxLevel, collapsed, selectedKey, filterMatches, branchCaps]
  );

  const visibleNodes = useMemo(() => [...placed.values()].filter((p) => p.visible), [placed]);
  const connectors = useMemo(() => {
    const out: { d: string; color: string; dashed: boolean; key: string }[] = [];
    for (const p of visibleNodes) {
      const kids = forest.children.get(p.key) ?? [];
      for (const k of kids) {
        const c = placed.get(k.key);
        if (!c || !c.visible) continue;
        const base = nodeBaseColor(k);
        const childStatus = k.statusId != null ? statusById.get(k.statusId) : undefined;
        out.push({
          key: `${p.key}->${k.key}`,
          d: connectorPath(p.x, p.y, c.x, c.y, layout),
          color: base,
          dashed: childStatus?.kind === "blocked" || !!taskById.get(Number(k.id))?.is_blocked,
        });
      }
    }
    return out;
  }, [visibleNodes, forest, placed, layout, statusById, taskById]);

  function nodeBaseColor(n: MindNode): string {
    if (n.type === "category" || n.type === "project") return normalizeHex(n.color);
    const st = n.statusId != null ? statusById.get(n.statusId) : undefined;
    const stage = st?.stage_id != null ? stageById.get(st.stage_id) : undefined;
    return normalizeHex(stage?.color_base ?? st?.shade ?? st?.color ?? "#64748b");
  }

  const fitToView = useCallback(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const r = vp.getBoundingClientRect();
    const sx = (r.width - 120) / Math.max(1, bounds.w);
    const sy = (r.height - 120) / Math.max(1, bounds.h);
    const s = Math.max(0.35, Math.min(1.4, Math.min(sx, sy)));
    setScale(Math.round(s * 100) / 100);
    setTx(48);
    setTy(32);
  }, [bounds]);

  useEffect(() => {
    if (visibleNodes.length > 0 && !loading) {
      const t = window.setTimeout(() => fitToView(), 60);
      return () => window.clearTimeout(t);
    }
  }, [scope, depth, layout, loading]); // eslint-disable-line react-hooks/exhaustive-deps

  const focusNode = useCallback(
    (key: string) => {
      const p = placed.get(key);
      const vp = viewportRef.current;
      if (!p || !vp) return;
      const r = vp.getBoundingClientRect();
      const s = Math.max(scale, 1);
      const pad = 48;
      setScale(s);
      if (layout === "horizontal") {
        // Center vertically; keep X unless node is off-screen, then minimal shift.
        setTy(Math.round(r.height / 2 - (p.y + 60) * s));
        setTx((prevTx) => {
          const left = p.x * s + prevTx;
          const right = left + NODE_W * s;
          if (left >= pad && right <= r.width - pad) return prevTx;
          if (left < pad) return Math.round(prevTx + (pad - left));
          return Math.round(prevTx - (right - (r.width - pad)));
        });
      } else {
        // Vertical layout: center horizontally; keep Y unless off-screen.
        setTx(Math.round(r.width / 2 - (p.x + NODE_W / 2) * s));
        setTy((prevTy) => {
          const top = p.y * s + prevTy;
          const bottom = top + 120 * s;
          if (top >= pad && bottom <= r.height - pad) return prevTy;
          if (top < pad) return Math.round(prevTy + (pad - top));
          return Math.round(prevTy - (bottom - (r.height - pad)));
        });
      }
    },
    [placed, scale, layout]
  );

  // Pan: left-drag or middle-drag moves canvas; middle-click without drag steps zoom-in.
  // Plain wheel zooms canvas to cursor (viewport-only); Ctrl/Cmd+wheel passes through to browser page zoom.
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      d.moved = true;
      setTx(Math.round(d.ox + (e.clientX - d.sx)));
      setTy(Math.round(d.oy + (e.clientY - d.sy)));
    };
    const onUp = (e: MouseEvent) => {
      const d = dragRef.current;
      dragRef.current = null;
      // Middle-click (no drag) => step zoom-in to cursor.
      if (d && d.btn === 1 && !d.moved) {
        const vp = viewportRef.current;
        if (vp) {
          const r = vp.getBoundingClientRect();
          const mx = e.clientX - r.left;
          const my = e.clientY - r.top;
          setScale((prev) => {
            const next = Math.min(1.8, Math.round((prev + 0.15) * 100) / 100);
            const k = next / prev;
            setTx((x) => Math.round(mx - (mx - x) * k));
            setTy((y) => Math.round(my - (my - y) * k));
            return next;
          });
        }
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const onWheel = (e: WheelEvent) => {
      // Let browser keep Ctrl/Cmd+wheel page zoom; never hijack it.
      if (e.ctrlKey || e.metaKey) return;
      e.preventDefault();
      const r = vp.getBoundingClientRect();
      const mx = e.clientX - r.left;
      const my = e.clientY - r.top;
      setScale((prev) => {
        const next = Math.max(0.35, Math.min(1.8, Math.round((prev - Math.sign(e.deltaY) * 0.1) * 100) / 100));
        // Keep cursor anchored: adjust translate for scale delta.
        const k = next / prev;
        setTx((x) => Math.round(mx - (mx - x) * k));
        setTy((y) => Math.round(my - (my - y) * k));
        return next;
      });
    };
    vp.addEventListener("wheel", onWheel, { passive: false });
    return () => vp.removeEventListener("wheel", onWheel);
  }, []);

  const expandAncestors = (key: string) => {
    const chain = ancestorKeys(key, forest.byKey);
    if (chain.length === 0) return;
    setCollapsed((prev) => {
      const next = new Set(prev);
      for (const a of chain) next.delete(a);
      return next;
    });
  };

  const gotoMatch = (dir: 1 | -1) => {
    if (searchMatches.length === 0) return;
    const next = (matchIdx + dir + searchMatches.length) % searchMatches.length;
    setMatchIdx(next);
    const key = searchMatches[next];
    expandAncestors(key);
    setSelectedKey(key);
    window.setTimeout(() => focusNode(key), 80);
  };

  const toggleCollapse = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const expandAll = () => {
    setCollapsed(new Set());
    setBranchCaps(new Map());
    setDepth("full");
  };
  const collapseAll = () => {
    // Collapse every parent; keep root visible.
    const parents = new Set<string>();
    for (const [k, kids] of forest.children.entries()) {
      if (kids.length > 0 && forest.byKey.get(k)?.level !== 0) parents.add(k);
    }
    setCollapsed(parents);
    setBranchCaps(new Map());
  };

  // Depth Badge: set per-branch absolute max level; clears collapse on that path so the tick takes effect.
  const setBranchDepth = (key: string, level: number | null) => {
    setBranchCaps((prev) => {
      const next = new Map(prev);
      if (level == null) next.delete(key);
      else next.set(key, level);
      return next;
    });
    if (level != null) {
      expandAncestors(key);
      setCollapsed((prev) => {
        if (!prev.has(key)) return prev;
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  const handleDepthChange = (v: string) => {
    if (v === "custom") return;
    setDepth(v as MindMapDepth);
    // Global depth resets all branch ticks.
    setBranchCaps(new Map());
    setCollapsed(new Set());
  };

  const selectedNode = selectedKey ? placed.get(selectedKey) ?? forest.byKey.get(selectedKey) ?? null : null;
  const selectedTask = selectedNode && (selectedNode.type === "task" || selectedNode.type === "subtask" || selectedNode.type === "microtask")
    ? taskById.get(Number(selectedNode.id)) ?? null
    : null;
  const selectedAncestors = selectedKey ? ancestorKeys(selectedKey, forest.byKey).reverse() : [];

  const descendantProgress = (taskId: number): { total: number; done: number } => {
    let total = 0;
    let done = 0;
    const stack = tasks.filter((t) => t.parent_id === taskId);
    const seen = new Set<number>();
    while (stack.length > 0) {
      const cur = stack.pop()!;
      if (seen.has(cur.id)) continue;
      seen.add(cur.id);
      total++;
      if (statusById.get(cur.status_id)?.is_done) done++;
      for (const t of tasks) if (t.parent_id === cur.id) stack.push(t);
    }
    return { total, done };
  };

  const handleChangeStatus = async (taskId: number, statusId: number) => {
    if (!auth.accessToken) return;
    setStatusSaving(true);
    try {
      const r = await fetch(`/api/v1/tasks/${taskId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth.accessToken}` },
        body: JSON.stringify({ status_id: statusId }),
      });
      if (!r.ok) throw new Error("Status change failed");
      setRefreshKey((k) => k + 1);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Status change failed");
    } finally {
      setStatusSaving(false);
    }
  };

  const handleDelete = async (taskId: number) => {
    if (!auth.accessToken || !confirm(`Delete task #${taskId} and its children?`)) return;
    try {
      const r = await fetch(`/api/v1/tasks/${taskId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${auth.accessToken}` },
      });
      if (!r.ok) throw new Error("Delete failed");
      if (selectedTask?.id === taskId) setSelectedKey(null);
      setCtx(null);
      setRefreshKey((k) => k + 1);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Delete failed");
    }
  };

  const subCounts = useMemo(() => {
    let t = 0, s = 0, m = 0;
    for (const x of tasks) {
      if (x.depth === 0) t++;
      else if (x.depth === 1) s++;
      else m++;
    }
    return { t, s, m };
  }, [tasks]);

  const canEdit = auth.role !== "guest";

  return (
    <main className="p-6 bg-surface min-h-screen text-on-surface">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold">Mind Map</h1>
          <p className="text-xs text-on-surface-variant mt-0.5">
            {isCategoryMode ? "Category" : "Project"}: {scopeName || `…${scopeId}`} · {projects.length} project{projects.length === 1 ? "" : "s"} · {tasks.length} items ({subCounts.t} tasks · {subCounts.s} subs · {subCounts.m} micros)
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <button
            onClick={() => setExpanded((v) => !v)}
            className="px-2.5 py-1.5 bg-surface-container hover:bg-surface-container-high rounded border border-subtle font-medium"
            title="Expand workspace (hide page chrome)"
          >
            {expanded ? "⇲ Compact" : "⇱ Expand"}
          </button>
          <button
            onClick={() => setShowTip((v) => !v)}
            className="w-7 h-7 rounded-full bg-surface-container hover:bg-surface-container-high border border-subtle font-bold text-on-surface-variant"
            title="Zoom & pan tips (scroll zooms canvas)"
            aria-label="Show zoom tips"
          >
            ?
          </button>
        </div>
      </div>

      {showTip && (
        <div className="mt-3 text-xs bg-surface-container-lowest border border-subtle rounded-xl p-3 flex items-start justify-between gap-3" role="status">
          <div>
            <strong>Tips:</strong> scroll to zoom to cursor (canvas only; <kbd className="px-1 rounded bg-surface-container border border-subtle font-mono">Ctrl</kbd>+scroll still zooms the page) · drag or middle-drag to pan · middle-click to step zoom-in · double-click background to fit · click a node for the inspector · right-click for Open / Add / Status / Focus.
          </div>
          <button onClick={() => setShowTip(false)} className="text-on-surface-variant hover:text-on-surface shrink-0" aria-label="Dismiss tips">✕</button>
        </div>
      )}

      {/* Toolbar */}
      <div className="mt-3 bg-surface-container-lowest border border-subtle rounded-xl p-2 flex items-center justify-between gap-2 flex-wrap text-xs shadow-sm">
        <div className="flex items-center gap-1">
          <button onClick={fitToView} className="px-2.5 py-1.5 rounded hover:bg-surface-container-low font-medium" title="Fit to view (F)">⛶ Fit</button>
          <button onClick={() => setScale((s) => Math.max(0.35, Math.round((s - 0.1) * 100) / 100))} className="w-7 h-7 rounded hover:bg-surface-container-low" title="Zoom out (−)" aria-label="Zoom out">−</button>
          <span className="w-12 text-center font-mono" aria-live="polite">{Math.round(scale * 100)}%</span>
          <button onClick={() => setScale((s) => Math.min(1.8, Math.round((s + 0.1) * 100) / 100))} className="w-7 h-7 rounded hover:bg-surface-container-low" title="Zoom in (+)" aria-label="Zoom in">+</button>
          <button onClick={() => { setScale(1); setTx(60); setTy(40); }} className="px-2 py-1.5 rounded hover:bg-surface-container-low" title="Reset zoom + position (0)">⟲</button>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <label className="flex items-center gap-1.5">
            <span className="text-on-surface-variant">Depth{hasCustomDepth ? " ✓" : ""}:</span>
            <select
              aria-label="mind map depth"
              value={depthValue}
              onChange={(e) => handleDepthChange(e.target.value)}
              className="px-2 py-1.5 rounded bg-surface-container border border-subtle text-on-surface"
            >
              {visibleDepths.map((d) => (
                <option key={d} value={d}>{depthLabel(d)}</option>
              ))}
              {hasCustomDepth && <option value="custom">Custom (mixed) ✓</option>}
            </select>
          </label>
          <label className="flex items-center gap-1.5">
            <span className="text-on-surface-variant">Layout:</span>
            <select
              aria-label="mind map layout"
              value={layout}
              onChange={(e) => setLayout(e.target.value as MindMapLayout)}
              className="px-2 py-1.5 rounded bg-surface-container border border-subtle text-on-surface"
            >
              <option value="horizontal">Horizontal (L→R)</option>
              <option value="vertical">Vertical (top-down)</option>
            </select>
          </label>
          <label className="flex items-center gap-1.5">
            <span className="text-on-surface-variant">Status:</span>
            <select
              aria-label="filter by status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-2 py-1.5 rounded bg-surface-container border border-subtle text-on-surface max-w-40"
            >
              <option value="">All statuses</option>
              {statuses.map((s) => (
                <option key={s.id} value={String(s.id)}>{s.name}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <div className="flex items-center gap-1">
            <input
              aria-label="search mind map"
              placeholder="Search node…"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setMatchIdx(0); }}
              onKeyDown={(e) => { if (e.key === "Enter") gotoMatch(1); }}
              className="px-2.5 py-1.5 rounded bg-surface-container border border-subtle text-on-surface w-44"
            />
            {query.trim() && (
              <span className="font-mono text-on-surface-variant">
                {searchMatches.length === 0 ? "0" : `${Math.min(matchIdx + 1, searchMatches.length)}/${searchMatches.length}`}
              </span>
            )}
            {query.trim() && searchMatches.length > 0 && (
              <>
                <button onClick={() => gotoMatch(-1)} className="px-2 py-1 rounded hover:bg-surface-container-low" title="Previous match" aria-label="Previous match">‹</button>
                <button onClick={() => gotoMatch(1)} className="px-2 py-1 rounded hover:bg-surface-container-low" title="Next match (Enter)" aria-label="Next match">›</button>
              </>
            )}
          </div>
          <button onClick={expandAll} className="px-2.5 py-1.5 rounded hover:bg-surface-container-low font-medium" title="Expand all to Full depth">Expand</button>
          <button onClick={collapseAll} className="px-2.5 py-1.5 rounded hover:bg-surface-container-low font-medium" title="Collapse all branches">Collapse</button>
          <button
            onClick={() => setInspectorOpen((v) => !v)}
            className={`px-2.5 py-1.5 rounded font-medium ${inspectorOpen ? "bg-surface-container" : "hover:bg-surface-container-low"}`}
            title="Toggle node inspector"
          >
            ☰ Inspector
          </button>
        </div>
      </div>

      {loading && <div role="status" className="mt-3 text-xs text-on-surface-variant">Loading mind map…</div>}
      {error && <div role="alert" className="mt-3 text-xs text-error">{error}</div>}

      {!loading && !error && projects.length === 0 && (
        <div className="mt-4 text-center text-sm text-outline py-10 bg-surface-container-lowest border border-subtle rounded-xl">
          This Category does not contain any Projects.
        </div>
      )}
      {!loading && !error && projects.length > 0 && tasks.length === 0 && (
        <div className="mt-4 text-center text-sm text-outline py-10 bg-surface-container-lowest border border-subtle rounded-xl">
          This {isCategoryMode ? "Category" : "Project"} does not contain any Tasks yet.
        </div>
      )}
      {!loading && !error && statusFilter && filterMatches && filterMatches.size === 0 && (
        <div className="mt-3 text-xs text-on-surface-variant">No items match the currently applied filters. Structural ancestors dimmed.</div>
      )}

      {/* Stage */}
      {projects.length > 0 && (
        <div className={`mt-4 rounded-xl overflow-hidden bg-surface-container-lowest border border-subtle shadow-sm flex ${expanded ? "min-h-[80vh]" : ""}`}>
          <div
            ref={viewportRef}
            className="relative flex-1 h-[640px] overflow-hidden cursor-grab active:cursor-grabbing select-none"
            style={{ backgroundImage: "radial-gradient(#dce9ff 1.25px, transparent 1.25px)", backgroundSize: "24px 24px" }}
            onMouseDown={(e) => {
              if ((e.target as HTMLElement).closest("button,input,select,a,details")) return;
              if (e.button === 1) e.preventDefault();
              dragRef.current = { sx: e.clientX, sy: e.clientY, ox: tx, oy: ty, btn: e.button, moved: false };
            }}
            onDoubleClick={(e) => {
              if ((e.target as HTMLElement).closest("[data-node]")) return;
              fitToView();
            }}
            onContextMenu={(e) => e.preventDefault()}
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "+" || e.key === "=") setScale((s) => Math.min(1.8, Math.round((s + 0.1) * 100) / 100));
              else if (e.key === "-") setScale((s) => Math.max(0.35, Math.round((s - 0.1) * 100) / 100));
              else if (e.key === "0") { setScale(1); setTx(60); setTy(40); }
              else if (e.key === "f" || e.key === "F") fitToView();
              else if (e.key === "Escape") { setCtx(null); setShowTip(false); }
            }}
            aria-label="Mind map canvas. Scroll to zoom canvas, Control plus scroll zooms the page. Drag or middle-drag to pan."
          >
            <div
              className="absolute left-0 top-0 origin-top-left"
              style={{ width: bounds.w, height: bounds.h, transform: `translate(${tx}px, ${ty}px) scale(${scale})` }}
            >
              <svg className="absolute inset-0 pointer-events-none" width={bounds.w} height={bounds.h}>
                {connectors.map((c) => (
                  <path key={c.key} d={c.d} fill="none" stroke={c.color} strokeWidth={2} opacity={0.75} strokeDasharray={c.dashed ? "5,4" : undefined} strokeLinecap="round" />
                ))}
              </svg>
              {visibleNodes.map((p) => (
                <NodeCard
                  key={p.key}
                  node={p}
                  base={nodeBaseColor(p)}
                  maxLevel={isCategoryMode ? 4 : 3}
                  branchCap={branchCaps.get(p.key)}
                  selected={selectedKey === p.key}
                  highlighted={searchMatches[matchIdx] === p.key && query.trim().length > 0}
                  status={p.statusId != null ? statusById.get(p.statusId) : undefined}
                  signal={p.statusId != null ? signals.get(p.statusId) : undefined}
                  dimmed={p.dimmed}
                  onSelect={() => { setSelectedKey(p.key); setInspectorOpen(true); }}
                  onToggle={() => toggleCollapse(p.key)}
                  onSetBranchDepth={(lvl) => setBranchDepth(p.key, lvl)}
                  onFocus={() => focusNode(p.key)}
                  onContext={(e) => { e.preventDefault(); setCtx({ x: e.clientX, y: e.clientY, key: p.key }); }}
                  onOpenEdit={() => {
                    if (p.type === "task" || p.type === "subtask" || p.type === "microtask") {
                      setEdit({ id: Number(p.id), projectId: p.projectId ?? scopeId });
                    }
                  }}
                />
              ))}
            </div>

            {/* Minimap radar */}
            <div className="absolute bottom-3 left-3 w-52 h-32 bg-surface-container-lowest/90 backdrop-blur rounded-lg shadow-xl p-2 z-20">
              <div className="flex items-center justify-between pb-1">
                <span className="text-[10px] uppercase tracking-wider text-outline">Radar</span>
                <span className="text-[10px] text-outline font-mono">{visibleNodes.length} nodes</span>
              </div>
              <div className="relative w-full h-[88px] bg-surface-container-low rounded overflow-hidden">
                {visibleNodes.slice(0, 400).map((p) => (
                  <div
                    key={p.key}
                    className="absolute rounded-[1px]"
                    title={p.name}
                    style={{
                      left: `${Math.min(96, (p.x / Math.max(1, bounds.w)) * 100)}%`,
                      top: `${Math.min(92, (p.y / Math.max(1, bounds.h)) * 100)}%`,
                      width: p.level === 0 ? 10 : 7,
                      height: 5,
                      backgroundColor: nodeBaseColor(p),
                      outline: selectedKey === p.key ? "1.5px solid #0051d5" : "none",
                    }}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* RHS Node Inspector */}
          {inspectorOpen && (
            <aside className="w-[360px] shrink-0 border-l border-subtle bg-surface-container-lowest flex flex-col max-h-[640px]" aria-label="Node inspector">
              <Inspector
                node={selectedNode}
                ancestors={selectedAncestors.map((k) => forest.byKey.get(k)).filter((n): n is MindNode => !!n)}
                task={selectedTask}
                statuses={statuses}
                signal={selectedNode?.statusId != null ? signals.get(selectedNode.statusId) : undefined}
                statusName={selectedNode?.statusId != null ? statusById.get(selectedNode.statusId)?.name : undefined}
                progress={selectedTask ? descendantProgress(selectedTask.id) : null}
                canEdit={canEdit}
                saving={statusSaving}
                onClose={() => setInspectorOpen(false)}
                onFocus={() => selectedKey && focusNode(selectedKey)}
                onEdit={() => {
                  if (selectedTask) setEdit({ id: selectedTask.id, projectId: selectedTask.project_id });
                }}
                onDrawer={() => {
                  if (selectedTask) setDrawer({ id: selectedTask.id, projectId: selectedTask.project_id });
                }}
                onAddChild={(kind) => {
                  if (!selectedTask) return;
                  if (selectedTask.depth >= 2) { alert("Microtask leaf cannot gain children."); return; }
                  setCreate({ projectId: selectedTask.project_id, parentId: selectedTask.id, kind });
                }}
                onSelectAncestor={(k) => { expandAncestors(k); setSelectedKey(k); focusNode(k); }}
                onChangeStatus={(sid) => selectedTask && handleChangeStatus(selectedTask.id, sid)}
              />
            </aside>
          )}
        </div>
      )}

      {/* Context menu */}
      {ctx && (() => {
        const n = forest.byKey.get(ctx.key);
        if (!n) return null;
        const isTask = n.type === "task" || n.type === "subtask" || n.type === "microtask";
        const tid = isTask ? Number(n.id) : null;
        return (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setCtx(null)} onContextMenu={(e) => { e.preventDefault(); setCtx(null); }} />
            <div
              role="menu"
              aria-label={`Actions for ${n.name}`}
              className="fixed z-50 w-60 rounded-lg border border-subtle bg-surface-container-lowest shadow-xl py-1 text-xs"
              style={{ left: Math.min(ctx.x, window.innerWidth - 260), top: Math.min(ctx.y, window.innerHeight - 300) }}
            >
              <div className="px-3 py-1.5 font-mono text-[10px] text-on-surface-variant border-b border-subtle truncate">{n.code ?? `#${String(n.id)}`} · {n.name}</div>
              <button role="menuitem" className="w-full text-left px-3 py-2 hover:bg-surface-container" onClick={() => { setSelectedKey(n.key); expandAncestors(n.key); focusNode(n.key); setCtx(null); }}>◎ Focus on Node</button>
              {isTask && (
                <>
                  <button role="menuitem" className="w-full text-left px-3 py-2 hover:bg-surface-container" onClick={() => { setEdit({ id: tid!, projectId: n.projectId ?? scopeId }); setCtx(null); }}>✎ Open / Edit</button>
                  <button role="menuitem" className="w-full text-left px-3 py-2 hover:bg-surface-container" onClick={() => { setDrawer({ id: tid!, projectId: n.projectId ?? scopeId }); setCtx(null); }}>⧉ Advanced drawer</button>
                  {canEdit && (
                    <>
                      <button
                        role="menuitem"
                        className="w-full text-left px-3 py-2 hover:bg-surface-container"
                        onClick={() => {
                          const t = taskById.get(tid!);
                          if (t && t.depth >= 2) { alert("Microtask leaf cannot gain children."); return; }
                          setCreate({ projectId: n.projectId ?? scopeId, parentId: tid, kind: t?.depth === 0 ? "Subtask" : "Microtask" });
                          setCtx(null);
                        }}
                      >
                        + Add Child Item
                      </button>
                      <button role="menuitem" className="w-full text-left px-3 py-2 text-error hover:bg-surface-container" onClick={() => handleDelete(tid!)}>🗑 Delete</button>
                    </>
                  )}
                </>
              )}
              <button role="menuitem" className="w-full text-left px-3 py-2 hover:bg-surface-container" onClick={() => { toggleCollapse(n.key); setCtx(null); }}>
                {collapsed.has(n.key) ? "▸ Expand Node" : "▾ Collapse Node"}
              </button>
            </div>
          </>
        );
      })()}

      {drawer && (
        <TaskDrawer taskId={drawer.id} projectId={drawer.projectId} onClose={() => setDrawer(null)} onUpdated={() => setRefreshKey((k) => k + 1)} />
      )}
      {edit && (
        <TaskDialog projectId={edit.projectId} mode="edit" taskId={edit.id} onClose={() => setEdit(null)} onUpdated={() => setRefreshKey((k) => k + 1)} />
      )}
      {create && (
        <TaskDialog
          projectId={create.projectId}
          mode="create"
          initialParentId={create.parentId}
          initialKind={create.kind}
          onClose={() => setCreate(null)}
          onCreated={(newId) => {
            setCreate(null);
            setDepth("full");
            setRefreshKey((k) => k + 1);
            window.setTimeout(() => {
              const key = `task:${newId}`;
              expandAncestors(key);
              setSelectedKey(key);
              focusNode(key);
            }, 400);
          }}
        />
      )}
    </main>
  );
}

function NodeCard(props: {
  node: MindNode & { x: number; y: number; dimmed: boolean; collapsed: boolean };
  base: string;
  maxLevel: number;
  branchCap?: number;
  selected: boolean;
  highlighted: boolean;
  status?: StatusInfo;
  signal?: { glyph: string; weight: number; label: string; milestone: boolean };
  dimmed: boolean;
  onSelect: () => void;
  onToggle: () => void;
  onSetBranchDepth: (level: number | null) => void;
  onFocus: () => void;
  onContext: (e: React.MouseEvent) => void;
  onOpenEdit: () => void;
}) {
  const { node, base, maxLevel, branchCap, selected, highlighted, status, signal, dimmed } = props;
  const fill = levelShade(base, node.level, maxLevel);
  const isRoot = node.level === 0;
  const depthLevels = Array.from({ length: maxLevel }, (_, i) => i + 1).filter((l) => l > node.level);
  return (
    <div
      data-node={node.key}
      className="absolute"
      style={{ left: node.x, top: node.y, width: NODE_W, opacity: dimmed ? 0.45 : 1 }}
      onContextMenu={props.onContext}
    >
      <div
        role="button"
        tabIndex={0}
        aria-label={`${node.type} ${node.name}${signal ? `, ${signal.weight}% ${signal.label}` : ""}`}
        onClick={props.onSelect}
        onDoubleClick={props.onOpenEdit}
        onKeyDown={(e) => { if (e.key === "Enter") props.onSelect(); }}
        className={`rounded-xl p-3 shadow flex flex-col gap-1.5 cursor-pointer transition-transform hover:scale-[1.01] bg-surface-container-lowest ${selected ? "ring-2 ring-secondary shadow-xl" : highlighted ? "ring-2 ring-amber-500 shadow-lg" : "shadow-md"}`}
        style={{ borderLeft: `4px solid ${base}`, background: `linear-gradient(90deg, ${fill}26, #ffffff 55%)` }}
        title={`${node.code ? `${node.code} · ` : ""}${node.name}${signal ? ` — ${signal.weight}% ${signal.label}${signal.milestone ? " · milestone" : ""}` : ""}`}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded bg-surface-container text-on-surface-variant truncate max-w-[150px]">
            {node.code ?? `#${String(node.id)}`} · L{node.level}
          </span>
          <span className="text-[10px] uppercase tracking-wide text-on-surface-variant">{node.type}{signal?.milestone ? " ★" : ""}</span>
        </div>
        <div className={`font-semibold leading-tight truncate ${isRoot ? "text-[15px]" : "text-[13px]"}`}>{node.name}</div>
        <div className="flex items-center justify-between text-[11px] text-on-surface-variant">
          <span className="flex items-center gap-1.5 min-w-0">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: base }} />
            <span className="truncate">{status?.name ?? (node.type === "category" ? `${node.childCount} projects` : node.type === "project" ? `${node.childCount} items` : "—")}</span>
            {signal && (
              <span className="font-mono shrink-0" title={`${signal.weight}% within stage · ${signal.label}`}>
                {signal.glyph} {signal.weight}%
              </span>
            )}
          </span>
          {node.hasChildren && (
            <span className="font-mono shrink-0">+{node.childCount}</span>
          )}
        </div>
      </div>
      {node.hasChildren && (
        <div className="absolute -right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
          {branchCap != null && (
            <span className="px-1 py-px rounded-full bg-secondary text-white text-[9px] font-mono shadow" title={`Branch depth ticked to L${branchCap} (Custom)`}>✓L{branchCap}</span>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); props.onToggle(); }}
            onDoubleClick={(e) => e.stopPropagation()}
            className="w-6 h-6 rounded-full bg-surface-container-lowest shadow flex items-center justify-center text-on-surface hover:bg-surface-container text-sm"
            title={node.collapsed ? "Expand branch" : "Collapse branch"}
            aria-label={node.collapsed ? "Expand branch" : "Collapse branch"}
          >
            {node.collapsed ? "+" : "−"}
          </button>
          {depthLevels.length > 0 && (
            <details className="relative" onClick={(e) => e.stopPropagation()}>
              <summary className="w-6 h-6 rounded-full bg-surface-container shadow flex items-center justify-center text-on-surface-variant hover:text-on-surface text-[11px] cursor-pointer list-none" title="Tick branch depth (updates Depth menu to Custom)">···</summary>
              <div className="absolute right-0 top-7 z-30 w-32 rounded-lg border border-subtle bg-surface-container-lowest shadow-xl py-1 text-[11px]">
                <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-outline">Branch depth</div>
                {depthLevels.map((l) => (
                  <button
                    key={l}
                    onClick={(e) => { e.stopPropagation(); props.onSetBranchDepth(l); (e.currentTarget.closest("details") as HTMLDetailsElement | null)?.removeAttribute("open"); }}
                    className={`w-full text-left px-2 py-1 hover:bg-surface-container flex items-center justify-between ${branchCap === l ? "font-bold text-secondary" : ""}`}
                    title={`Show this branch to L${l}`}
                  >
                    <span>L{l}</span>
                    {branchCap === l && <span aria-hidden="true">✓</span>}
                  </button>
                ))}
                {branchCap != null && (
                  <button
                    onClick={(e) => { e.stopPropagation(); props.onSetBranchDepth(null); (e.currentTarget.closest("details") as HTMLDetailsElement | null)?.removeAttribute("open"); }}
                    className="w-full text-left px-2 py-1 hover:bg-surface-container text-on-surface-variant"
                    title="Clear branch tick (back to global depth)"
                  >
                    Clear ✓
                  </button>
                )}
              </div>
            </details>
          )}
        </div>
      )}
      {selected && (
        <button
          onClick={(e) => { e.stopPropagation(); props.onFocus(); }}
          className="absolute -top-2.5 -right-2.5 px-2 py-0.5 rounded-full bg-secondary text-white text-[10px] shadow"
          title="Center on this node"
        >
          ◎
        </button>
      )}
    </div>
  );
}

function Inspector(props: {
  node: (MindNode & { x: number; y: number }) | MindNode | null;
  ancestors: MindNode[];
  task?: ApiTask | null;
  statuses: StatusInfo[];
  signal?: { glyph: string; weight: number; label: string; milestone: boolean };
  statusName?: string;
  progress?: { total: number; done: number } | null;
  canEdit: boolean;
  saving: boolean;
  onClose: () => void;
  onFocus: () => void;
  onEdit: () => void;
  onDrawer: () => void;
  onAddChild: (kind: "Subtask" | "Microtask") => void;
  onSelectAncestor: (key: string) => void;
  onChangeStatus: (sid: number) => void;
}) {
  const { node, ancestors, task, statuses, signal, statusName, progress, canEdit, saving } = props;
  if (!node) {
    return (
      <div className="p-4 text-xs text-on-surface-variant">
        <div className="flex items-center justify-between mb-2">
          <strong className="text-sm text-on-surface">Node Inspector</strong>
          <button onClick={props.onClose} className="hover:text-on-surface" aria-label="Close inspector">✕</button>
        </div>
        Select a node on the canvas to inspect ancestry, status signals, and actions.
      </div>
    );
  }
  const isTaskLike = node.type === "task" || node.type === "subtask" || node.type === "microtask";
  return (
    <div className="flex flex-col h-full">
      <div className="p-3 bg-surface-container-low/60 flex items-center justify-between border-b border-subtle">
        <strong className="text-[13px]">Node Inspector</strong>
        <button onClick={props.onClose} className="hover:text-on-surface text-on-surface-variant" aria-label="Close inspector">✕</button>
      </div>
      <div className="p-3 space-y-3 overflow-y-auto flex-1 text-xs">
        <div>
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-secondary bg-surface-container px-1.5 py-0.5 rounded">{node.code ?? `#${String(node.id)}`} · L{node.level}</span>
            <span className="uppercase text-[10px] text-on-surface-variant">{node.type}{signal?.milestone ? " ★ milestone" : ""}</span>
          </div>
          <h2 className="text-[15px] font-semibold mt-1 leading-tight">{node.name}</h2>
          <div className="mt-2 p-2 bg-surface-container-low rounded">
            <div className="text-[10px] uppercase tracking-wider text-outline mb-1">Ancestry trace</div>
            <div className="flex flex-wrap items-center gap-1">
              {ancestors.map((a) => (
                <span key={a.key} className="flex items-center gap-1">
                  <button onClick={() => props.onSelectAncestor(a.key)} className="hover:text-secondary hover:underline" title={`Go to ${a.name}`}>
                    {a.code ?? a.name}
                  </button>
                  <span className="text-outline">›</span>
                </span>
              ))}
              <span className="text-secondary font-semibold">{node.code ?? node.name}</span>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="p-2 bg-surface-container-low rounded">
            <div className="text-[10px] text-outline">State</div>
            <div className="font-semibold flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: node.color }} />
              {statusName ?? "—"}
            </div>
            {signal && <div className="font-mono text-on-surface-variant">{signal.glyph} {signal.weight}% · {signal.label}</div>}
          </div>
          <div className="p-2 bg-surface-container-low rounded">
            <div className="text-[10px] text-outline">Children</div>
            <div className="font-semibold text-sm">{node.childCount}</div>
            {progress && progress.total > 0 && <div className="font-mono text-on-surface-variant">{progress.done}/{progress.total} done</div>}
          </div>
        </div>
        {task && (
          <div className="p-2 bg-surface-container-low rounded space-y-1.5">
            <div className="text-[10px] uppercase tracking-wider text-outline">Execution context</div>
            <div className="flex justify-between"><span className="text-on-surface-variant">Assignees</span><span className="font-mono">{task.assignee_ids?.length ? task.assignee_ids.map((a) => `U${a}`).join(", ") : "—"}</span></div>
            <div className="flex justify-between"><span className="text-on-surface-variant">Due</span><span className="font-mono">{task.due_date ?? "—"}</span></div>
            {task.is_blocked && <div className="text-error font-semibold">● Blocked — needs attention</div>}
            {canEdit && (
              <label className="flex items-center gap-2 pt-1">
                <span className="text-on-surface-variant">Status:</span>
                <select
                  aria-label="change status"
                  value={String(task.status_id)}
                  disabled={saving}
                  onChange={(e) => props.onChangeStatus(Number(e.target.value))}
                  className="flex-1 px-2 py-1.5 rounded bg-surface-container-lowest border border-subtle"
                >
                  {statuses.map((s) => (
                    <option key={s.id} value={String(s.id)}>{s.name}{s.is_done ? " (done)" : ""}</option>
                  ))}
                </select>
              </label>
            )}
          </div>
        )}
        <div className="grid grid-cols-2 gap-1.5">
          <button onClick={props.onFocus} className="px-2 py-1.5 rounded bg-surface-container hover:bg-surface-container-high font-medium">◎ Focus</button>
          {isTaskLike && <button onClick={props.onEdit} className="px-2 py-1.5 rounded bg-surface-container hover:bg-surface-container-high font-medium">✎ Edit</button>}
          {isTaskLike && canEdit && task && task.depth < 2 && (
            <button onClick={() => props.onAddChild(task.depth === 0 ? "Subtask" : "Microtask")} className="px-2 py-1.5 rounded bg-surface-container hover:bg-surface-container-high font-medium">+ Add Child</button>
          )}
          {isTaskLike && <button onClick={props.onDrawer} className="px-2 py-1.5 rounded bg-surface-container hover:bg-surface-container-high font-medium">⧉ Drawer</button>}
        </div>
      </div>
      <div className="p-3 border-t border-subtle bg-surface-container-low/60 text-[11px] text-on-surface-variant">
        Single-click selects · double-click edits · right-click for full menu · scroll zooms canvas.
      </div>
    </div>
  );
}
