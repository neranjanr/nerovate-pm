import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import TaskFilters, { EMPTY_FILTERS, type TaskFilterState } from "../components/TaskFilters";
import TaskDialog from "../components/TaskDialog";
import { useAuth } from "../stores/auth";
import { deriveStatusSignal, kindLabel } from "../utils/statusSignals";

interface KanbanTask {
  id: number;
  project_id: number;
  title: string;
  status_id: number;
  depth: number;
  parent_id?: number | null;
  wbs?: string;
  priority: string;
  start_date: string;
  due_date?: string | null;
  assignee_ids: number[];
  tag_names: string[];
  blocked_by_ids: number[];
  is_blocked: boolean;
  estimate_mins?: number | null;
  time_spent_mins: number;
}

interface StageInfo {
  id: number;
  name: string;
  order: number;
  color_base: string;
}

interface StatusInfo {
  id: number;
  name: string;
  order: number;
  is_done?: boolean;
  is_milestone?: boolean;
  kind?: string;
  stage_id?: number | null;
  shade?: string | null;
  color?: string;
}

interface ProjectRef {
  id: number;
  code: string;
  name: string;
  color?: string | null;
}

interface PopupState {
  kind: "stage" | "status";
  stageId?: number | null;
  statusId?: number | null;
  title: string;
  subtitle: string;
}

interface ConfirmState {
  taskId: number;
  taskTitle: string;
  fromStatusId: number;
  fromName: string;
  toStatusId: number;
  toName: string;
  destStageId?: number | null;
  choices?: StatusInfo[];
}

interface ToastState {
  taskId: number;
  taskTitle: string;
  fromStatusId: number;
  fromName: string;
  toStatusId: number;
  toName: string;
}

interface BucketState {
  stageId: number;
  x: number;
  y: number;
}

/** kan2 §20 — density modes. */
type Density = "comfortable" | "compact" | "ultra";
/** kan2 §10.2 — configurable confirmation rules. */
type ConfirmMode = "always" | "stage-change" | "done-only" | "never";

interface CtxMenu {
  taskId: number;
  projectId: number;
  depth: number;
  title: string;
  x: number;
  y: number;
}

/** kan2 §7.1 hover delay — agreed 1s in grill Round 2 (Q6). */
const DROP_BUCKET_DELAY_MS = 1000;
/** kan2 §25.1 — searchable bucket threshold. */
const BUCKET_SEARCH_THRESHOLD = 6;
/** kan2 §11 — undo toast lifetime. */
const UNDO_MS = 8000;
/** kan2 §12 — edge zone for drag auto-scroll. */
const EDGE_PX = 64;
/** kan2 §29 — lightweight windowing: cards rendered per column before "Show more". */
const COL_CARD_LIMIT = 50;

function signalClass(kind: string, isDone: boolean): string {
  if (isDone) return "text-emerald-600";
  if (kind === "blocked") return "text-rose-600 font-bold";
  if (kind === "attention") return "text-amber-600";
  if (kind === "cancelled") return "text-slate-400";
  if (kind === "on_hold") return "text-sky-600";
  return "text-slate-500";
}

function stageLabel(stageId: number | null | undefined, stages: StageInfo[]): string {
  return stages.find((s) => s.id === stageId)?.name ?? "";
}

function fullName(
  statusId: number,
  statusById: Map<number, StatusInfo>,
  stages: StageInfo[]
): string {
  const s = statusById.get(statusId);
  if (!s) return `Status ${statusId}`;
  const st = stageLabel(s.stage_id, stages);
  return st ? `${st} > ${s.name}` : s.name;
}

/**
 * Kanban tab (project + category modes sharing one component).
 * Slice 1 (kan2 §§3,4,7-11,13):
 * - Stable geometry: populated Stages share width (~1/6 viewport target),
 *   empty Stages collapse to thin rails. Drag never resizes layout.
 * - Temporary Drop Bucket overlay (1s delay) for leaf-Status picking,
 *   including same-Stage leaf-to-leaf moves. Never expands columns.
 * - Confirm dialog with editable Stage+Status, Undo toast, per-column Add Task.
 * Terminology: Stage = kan2 Tier 1 group, Status = kan2 Tier 2 leaf.
 */
export default function Kanban() {
  const auth = useAuth();
  const { id } = useParams();
  const location = useLocation();
  const isCategoryMode = location.pathname.startsWith("/categories/");
  const scopeId = id ?? "";
  const canDrag = auth.role !== "guest";
  const canCreate = auth.role !== "guest";

  const [tasks, setTasks] = useState<KanbanTask[]>([]);
  const [statuses, setStatuses] = useState<StatusInfo[]>([]);
  const [stages, setStages] = useState<StageInfo[]>([]);
  const [projects, setProjects] = useState<ProjectRef[]>([]);
  const [scopeName, setScopeName] = useState("");
  const [profileId, setProfileId] = useState<number | null>(null);
  const [filters, setFilters] = useState<TaskFilterState>({ ...EMPTY_FILTERS });
  const [projectFilter, setProjectFilter] = useState("");
  const [viewMode, setViewMode] = useState<"standard" | "expanded">("standard");
  const [expandedStages, setExpandedStages] = useState<Record<number, boolean>>({});
  const [popup, setPopup] = useState<PopupState | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [confirmStage, setConfirmStage] = useState("");
  const [confirmLeaf, setConfirmLeaf] = useState("");
  const [edit, setEdit] = useState<{ id: number; projectId: number } | null>(null);
  const [create, setCreate] = useState<{
    projectId: string | number;
    statusId: number;
    initialParentId?: number | null;
    initialLevel?: 0 | 1 | 2;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dragId, setDragId] = useState<number | null>(null);
  const [dragOverStageId, setDragOverStageId] = useState<number | null>(null);
  const [bucket, setBucket] = useState<BucketState | null>(null);
  const [bucketSearch, setBucketSearch] = useState("");
  const [bucketLeaf, setBucketLeaf] = useState<number | null>(null);
  const [bucketHover, setBucketHover] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  // Slice 2 (kan2 §§10.2,12,14-17,19-20): persisted prefs + transient menus.
  const [density, setDensity] = useState<Density>("comfortable");
  const [confirmMode, setConfirmMode] = useState<ConfirmMode>("always");
  const [navVisible, setNavVisible] = useState(true);
  const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null);
  const [moveTo, setMoveTo] = useState<{ taskId: number; title: string; q: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; title: string } | null>(null);
  const [showAll, setShowAll] = useState<Record<string, boolean>>({});
  const [edge, setEdge] = useState<{ left: number; right: number }>({ left: 0, right: 0 });
  const [visibleStages, setVisibleStages] = useState<number[]>([]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const panRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const bucketTimer = useRef<number | null>(null);
  const toastTimer = useRef<number | null>(null);
  const dragPos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const autoDir = useRef<-1 | 0 | 1>(0);
  const autoSpeed = useRef(0);
  const autoRaf = useRef<number | null>(null);

  // Restore persisted view state per profile (persistent prefs only;
  // temporary bucket/drag/confirm/toast/menus never touch storage — kan2 §21.1).
  useEffect(() => {
    if (!profileId) return;
    try {
      const m = localStorage.getItem(`kanban:${profileId}:mode`);
      if (m === "standard" || m === "expanded") setViewMode(m);
      const c = localStorage.getItem(`kanban:${profileId}:expanded`);
      if (c) setExpandedStages(JSON.parse(c) as Record<number, boolean>);
      const d = localStorage.getItem(`kanban:${profileId}:density`);
      if (d === "comfortable" || d === "compact" || d === "ultra") setDensity(d);
      const cm = localStorage.getItem(`kanban:${profileId}:confirm`);
      if (cm === "always" || cm === "stage-change" || cm === "done-only" || cm === "never") setConfirmMode(cm);
      const nv = localStorage.getItem(`kanban:${profileId}:nav`);
      if (nv === "0") setNavVisible(false);
      else if (nv === "1") setNavVisible(true);
    } catch {
      // ignore corrupt storage
    }
  }, [profileId]);

  useEffect(() => {
    if (!profileId) return;
    try {
      localStorage.setItem(`kanban:${profileId}:mode`, viewMode);
      localStorage.setItem(`kanban:${profileId}:expanded`, JSON.stringify(expandedStages));
      localStorage.setItem(`kanban:${profileId}:density`, density);
      localStorage.setItem(`kanban:${profileId}:confirm`, confirmMode);
      localStorage.setItem(`kanban:${profileId}:nav`, navVisible ? "1" : "0");
    } catch {
      // storage full/blocked — view still works in-memory
    }
  }, [viewMode, expandedStages, profileId, density, confirmMode, navVisible]);

  // Middle-mouse pan: plain middle-drag pans horizontally,
  // Ctrl+middle-drag pans vertically. Left-drag DnD untouched.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onDown = (e: MouseEvent) => {
      if (e.button !== 1) return;
      e.preventDefault();
      panRef.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop };
      el.style.cursor = "grabbing";
    };
    const onMove = (e: MouseEvent) => {
      const p = panRef.current;
      if (!p) return;
      e.preventDefault();
      if (e.ctrlKey) {
        el.scrollTop = p.top - (e.clientY - p.y);
      } else {
        el.scrollLeft = p.left - (e.clientX - p.x);
      }
    };
    const onUp = () => {
      panRef.current = null;
      if (el) el.style.cursor = "";
    };
    el.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      el.removeEventListener("mousedown", onDown);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [loading]);

  // Global drag cleanup: bucket/hover state disappears on cancel (kan2 §7.4).
  useEffect(() => {
    const onEnd = () => {
      setDragId(null);
      setDragOverStageId(null);
      setBucket(null);
      setBucketSearch("");
      setBucketLeaf(null);
      setBucketHover(false);
      if (bucketTimer.current) {
        window.clearTimeout(bucketTimer.current);
        bucketTimer.current = null;
      }
    };
    document.addEventListener("dragend", onEnd);
    return () => document.removeEventListener("dragend", onEnd);
  }, []);

  // Escape closes transient menus/overlays (never touches persisted prefs).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setCtxMenu(null);
      setMoveTo(null);
      setDeleteTarget(null);
      closeBucket();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    return () => {
      if (bucketTimer.current) window.clearTimeout(bucketTimer.current);
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
      if (autoRaf.current) cancelAnimationFrame(autoRaf.current);
    };
  }, []);

  // kan2 §12 — progressive horizontal auto-scroll during drag.
  // Bucket interaction takes priority (§12.2): paused while pointer is on bucket.
  useEffect(() => {
    if (dragId == null) {
      autoDir.current = 0;
      if (autoRaf.current) cancelAnimationFrame(autoRaf.current);
      autoRaf.current = null;
      return;
    }
    const tick = () => {
      const el = scrollRef.current;
      if (el && autoDir.current !== 0 && !bucketHover) {
        el.scrollLeft += autoDir.current * autoSpeed.current;
      }
      autoRaf.current = requestAnimationFrame(tick);
    };
    autoRaf.current = requestAnimationFrame(tick);
    return () => {
      if (autoRaf.current) cancelAnimationFrame(autoRaf.current);
      autoRaf.current = null;
    };
  }, [dragId, bucketHover]);

  const handleBoardDragOver = (e: React.DragEvent) => {
    if (dragId == null) return;
    const el = scrollRef.current;
    if (!el || bucketHover) {
      autoDir.current = 0;
      return;
    }
    const rect = el.getBoundingClientRect();
    const distL = e.clientX - rect.left;
    const distR = rect.right - e.clientX;
    if (distL < EDGE_PX) {
      autoDir.current = -1;
      autoSpeed.current = 4 + ((EDGE_PX - distL) / EDGE_PX) * 20;
    } else if (distR < EDGE_PX) {
      autoDir.current = 1;
      autoSpeed.current = 4 + ((EDGE_PX - distR) / EDGE_PX) * 20;
    } else {
      autoDir.current = 0;
    }
  };

  // kan2 §16 — hidden-status awareness + §17 viewport tracking.
  const updateEdges = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const cRect = el.getBoundingClientRect();
    let left = 0;
    let right = 0;
    const vis: number[] = [];
    for (const child of Array.from(el.children)) {
      const sid = (child as HTMLElement).dataset.stageId;
      if (!sid) continue;
      const r = (child as HTMLElement).getBoundingClientRect();
      if (r.right <= cRect.left + 4) left += 1;
      else if (r.left >= cRect.right - 4) right += 1;
      else vis.push(Number(sid));
    }
    setEdge({ left, right });
    setVisibleStages(vis);
  }, []);

  useEffect(() => {
    updateEdges();
    window.addEventListener("resize", updateEdges);
    return () => window.removeEventListener("resize", updateEdges);
  }, [updateEdges, stages.length, tasks.length, viewMode]);

  const scrollByStages = (dir: -1 | 1) => {
    scrollRef.current?.scrollBy({ left: dir * 340, behavior: "smooth" });
  };

  const scrollToStage = (stageId: number) => {
    const el = scrollRef.current;
    if (!el) return;
    const target = el.querySelector(`[data-stage-id="${stageId}"]`);
    target?.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });
  };

  const fetchTasks = useCallback(() => {
    if (!auth.accessToken || !scopeId) return;
    setLoading(true);
    setError("");
    const p = new URLSearchParams(isCategoryMode ? { category_id: scopeId } : { project_id: scopeId });
    if (filters.search.trim()) p.set("search", filters.search.trim());
    if (filters.statusId) p.set("status", filters.statusId);
    if (filters.stageId) p.set("stage_id", filters.stageId);
    if (filters.assigneeId) p.set("assignee", filters.assigneeId);
    if (filters.watcherId) p.set("watcher", filters.watcherId);
    if (filters.tag.trim()) p.set("tag", filters.tag.trim());
    if (filters.depth) p.set("depth", filters.depth);
    if (filters.blocked) p.set("blocked", filters.blocked);
    if (filters.overdue) p.set("overdue", filters.overdue);
    fetch(`/api/v1/tasks?${p.toString()}`, { headers: { Authorization: `Bearer ${auth.accessToken}` } })
      .then((r) => {
        if (!r.ok) throw new Error(`Kanban failed: ${r.status}`);
        return r.json();
      })
      .then((rows) => {
        setTasks(rows);
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message || "Failed to load kanban");
        setLoading(false);
      });
  }, [auth.accessToken, scopeId, isCategoryMode, filters]);

  useEffect(() => {
    if (!auth.accessToken || !scopeId) return;
    const headers = { Authorization: `Bearer ${auth.accessToken}` };
    (async () => {
      try {
        let pid: number | null = null;
        if (isCategoryMode) {
          const [cat, projs] = await Promise.all([
            fetch(`/api/v1/categories/${scopeId}`, { headers }).then((r) => (r.ok ? r.json() : null)),
            fetch(`/api/v1/categories/${scopeId}/projects`, { headers }).then((r) => (r.ok ? r.json() : [])),
          ]);
          setProjects(projs ?? []);
          setScopeName(cat?.name ?? `Category ${scopeId}`);
          pid = cat?.status_profile_id ?? null;
        } else {
          const proj = await fetch(`/api/v1/projects/${scopeId}`, { headers }).then((r) =>
            r.ok ? r.json() : null
          );
          setScopeName(proj ? `${proj.code} · ${proj.name}` : `Project ${scopeId}`);
          setProjects(proj ? [{ id: proj.id, code: proj.code, name: proj.name, color: proj.color }] : []);
          pid = proj?.status_profile_id ?? null;
          if (proj?.category_id) {
            try {
              const cr = await fetch(`/api/v1/categories/${proj.category_id}`, { headers });
              if (cr.ok) {
                const cat = await cr.json();
                if (cat?.status_profile_id) pid = cat.status_profile_id;
              }
            } catch {
              // keep project-level profile
            }
          }
        }
        setProfileId(pid);
        if (!pid) {
          setStatuses([]);
          setStages([]);
          return;
        }
        const sp = await fetch(`/api/v1/status-profiles/${pid}`, { headers }).then((r) =>
          r.ok ? r.json() : null
        );
        if (sp) {
          setStatuses((sp?.statuses ?? []).slice().sort((a: StatusInfo, b: StatusInfo) => a.order - b.order));
          setStages((sp?.stages ?? []).slice().sort((a: StageInfo, b: StageInfo) => a.order - b.order));
        }
      } catch {
        // fetchTasks surfaces errors; profile stays empty
      }
    })();
  }, [auth.accessToken, scopeId, isCategoryMode]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks, refreshKey]);

  const statusById = useMemo(() => new Map(statuses.map((s) => [s.id, s])), [statuses]);
  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);

  const visibleTasks = useMemo(() => {
    let rows = tasks;
    if (isCategoryMode && projectFilter) rows = rows.filter((t) => String(t.project_id) === projectFilter);
    return rows;
  }, [tasks, isCategoryMode, projectFilter]);

  const filtersActive = useMemo(
    () =>
      filters.search.trim() !== "" ||
      filters.statusId !== "" ||
      filters.stageId !== "" ||
      filters.assigneeId !== "" ||
      filters.watcherId !== "" ||
      filters.tag.trim() !== "" ||
      filters.depth !== "" ||
      filters.blocked !== "" ||
      filters.overdue !== "",
    [filters]
  );

  const signalByStatus = useMemo(() => {
    const map = new Map<number, { glyph: string; weight: number; label: string; milestone: boolean }>();
    const byStage = new Map<number | null, StatusInfo[]>();
    for (const s of statuses) {
      const k = s.stage_id ?? null;
      byStage.set(k, [...(byStage.get(k) ?? []), s]);
    }
    for (const group of byStage.values()) {
      const ordered = [...group].sort((a, b) => a.order - b.order);
      ordered.forEach((s, i) => {
        const sig = deriveStatusSignal(i, ordered.length, s.kind ?? "normal", !!s.is_done);
        map.set(s.id, { ...sig, label: kindLabel(s.kind ?? "normal", !!s.is_done), milestone: !!s.is_milestone });
      });
    }
    return map;
  }, [statuses]);

  const stageGroups = useMemo(() => {
    const active = filters.stageId ? stages.filter((s) => String(s.id) === filters.stageId) : stages;
    return active.map((st) => {
      const leaves = statuses
        .filter((s) => s.stage_id === st.id)
        .map((s) => ({ status: s, rows: visibleTasks.filter((t) => t.status_id === s.id) }));
      const flat = leaves.flatMap((l) => l.rows);
      const done = leaves.filter((l) => l.status.is_done).reduce((n, l) => n + l.rows.length, 0);
      return { stage: st, leaves, flat, done };
    });
  }, [stages, statuses, visibleTasks, filters.stageId]);

  const isExpanded = (stageId: number) => viewMode === "expanded" || !!expandedStages[stageId];

  // Refresh edge/navigator tracking whenever the rendered columns change.
  useEffect(() => {
    updateEdges();
  }, [updateEdges, stageGroups]);

  const toggleStage = (stageId: number) =>
    setExpandedStages((prev) => ({ ...prev, [stageId]: !prev[stageId] }));

  const openStagePopup = (stageId: number) => {
    const g = stageGroups.find((x) => x.stage.id === stageId);
    if (!g) return;
    setPopup({
      kind: "stage",
      stageId,
      title: g.stage.name,
      subtitle: `${g.flat.length} item(s) · ${g.done} done`,
    });
  };

  const openStatusPopup = (statusId: number) => {
    const s = statusById.get(statusId);
    if (!s) return;
    const sig = signalByStatus.get(statusId);
    const count = visibleTasks.filter((t) => t.status_id === statusId).length;
    setPopup({
      kind: "status",
      statusId,
      title: s.name,
      subtitle: `${sig?.glyph ?? ""} ${sig?.weight ?? 0}% · ${count} item(s)${sig?.milestone ? " · ★ milestone" : ""}`,
    });
  };

  const popupRows = useMemo(() => {
    if (!popup) return [];
    const rows =
      popup.kind === "stage"
        ? visibleTasks.filter((t) => statusById.get(t.status_id)?.stage_id === popup.stageId)
        : visibleTasks.filter((t) => t.status_id === popup.statusId);
    return [...rows].sort((a, b) => {
      const pa = projectById.get(a.project_id)?.code ?? "";
      const pb = projectById.get(b.project_id)?.code ?? "";
      if (pa !== pb) return pa.localeCompare(pb);
      return (a.wbs ?? `#${a.id}`).localeCompare(b.wbs ?? `#${b.id}`);
    });
  }, [popup, visibleTasks, statusById, projectById]);

  // ---- Drop Bucket helpers (kan2 §§7-9, overlay only, no layout change) ----

  const clearBucketTimer = () => {
    if (bucketTimer.current) {
      window.clearTimeout(bucketTimer.current);
      bucketTimer.current = null;
    }
  };

  const handleStageDragOver = (e: React.DragEvent, stageId: number) => {
    if (dragId == null) return;
    e.preventDefault();
    dragPos.current = { x: e.clientX, y: e.clientY };
    if (dragOverStageId !== stageId) setDragOverStageId(stageId);
    // Schedule the temporary bucket after the agreed 1s hover delay.
    if (!bucket || bucket.stageId !== stageId) {
      if (bucketTimer.current == null) {
        bucketTimer.current = window.setTimeout(() => {
          setBucket({ stageId, x: dragPos.current.x, y: dragPos.current.y });
          setBucketSearch("");
          setBucketLeaf(null);
          bucketTimer.current = null;
        }, DROP_BUCKET_DELAY_MS);
      }
    } else {
      setBucket((b) => (b ? { ...b, x: dragPos.current.x, y: dragPos.current.y } : b));
    }
  };

  const handleStageDragLeave = () => {
    // Keep the bucket while the pointer is over the bucket itself (§7.4).
    window.setTimeout(() => {
      if (!bucketHover) {
        setDragOverStageId(null);
        setBucket(null);
        setBucketSearch("");
        setBucketLeaf(null);
        clearBucketTimer();
      }
    }, 60);
  };

  const closeBucket = () => {
    setBucket(null);
    setBucketSearch("");
    setBucketLeaf(null);
    setBucketHover(false);
    setDragOverStageId(null);
    clearBucketTimer();
  };

  // ---- Move / confirm / undo (kan2 §§10-11, §10.2 rules) ----

  const doMove = (taskId: number, fromStatusId: number, fromName: string, taskTitle: string, targetId: number) => {
    if (!auth.accessToken) return;
    fetch(`/api/v1/tasks/${taskId}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth.accessToken}` },
      body: JSON.stringify({ status_id: targetId }),
    })
      .then((r) => {
        if (!r.ok) throw new Error(`Status change failed: ${r.status}`);
        return r.json();
      })
      .then(() => {
        const toName = fullName(targetId, statusById, stages);
        showToast({ taskId, taskTitle, fromStatusId, fromName, toStatusId: targetId, toName });
        setConfirm(null);
        setDragId(null);
        setRefreshKey((k) => k + 1);
      })
      .catch((e) => setError(e.message));
  };

  /** kan2 §10.2 — does this move need confirmation under the current rule? */
  const needsConfirm = (fromStatusId: number, destStatusId: number): boolean => {
    if (confirmMode === "always") return true;
    if (confirmMode === "never") return false;
    if (confirmMode === "stage-change") {
      return statusById.get(fromStatusId)?.stage_id !== statusById.get(destStatusId)?.stage_id;
    }
    // "done-only": confirm when entering Done / Milestone / exception-kind Statuses.
    const d = statusById.get(destStatusId);
    return !!d && (!!d.is_done || !!d.is_milestone || (d.kind ?? "normal") !== "normal");
  };

  const requestMove = (taskId: number, destStatusId: number, destStageId?: number | null, choices?: StatusInfo[]) => {
    const t = visibleTasks.find((x) => x.id === taskId) ?? tasks.find((x) => x.id === taskId);
    if (!t) return;
    if (t.status_id === destStatusId) {
      closeBucket();
      return;
    }
    const fromName = fullName(t.status_id, statusById, stages);
    const toName = fullName(destStatusId, statusById, stages);
    const stageOf = (sid: number) => statusById.get(sid)?.stage_id ?? destStageId ?? null;
    if (!needsConfirm(t.status_id, destStatusId)) {
      closeBucket();
      doMove(taskId, t.status_id, fromName, t.title, destStatusId);
      return;
    }
    setConfirm({
      taskId,
      taskTitle: t.title,
      fromStatusId: t.status_id,
      fromName,
      toStatusId: destStatusId,
      toName,
      destStageId: destStageId ?? stageOf(destStatusId),
      choices,
    });
    setConfirmStage(String(destStageId ?? stageOf(destStatusId) ?? ""));
    setConfirmLeaf(choices && choices.length > 0 ? String(destStatusId) : String(destStatusId));
    closeBucket();
  };

  const requestStageDrop = (taskId: number, stageId: number, leafId?: number) => {
    const leaves = statuses.filter((s) => s.stage_id === stageId).sort((a, b) => a.order - b.order);
    if (leaves.length === 0) return;
    if (leafId != null) {
      requestMove(taskId, leafId, stageId, leaves.length > 1 ? leaves : undefined);
      return;
    }
    if (leaves.length === 1) requestMove(taskId, leaves[0].id, stageId);
    else requestMove(taskId, leaves[0].id, stageId, leaves);
  };

  const confirmStageLeaves = useMemo(() => {
    if (!confirmStage) return confirm?.choices ?? [];
    const sid = Number(confirmStage);
    return statuses.filter((s) => s.stage_id === sid).sort((a, b) => a.order - b.order);
  }, [confirmStage, statuses, confirm]);

  const showToast = (t: ToastState) => {
    setToast(t);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), UNDO_MS);
  };

  const submitMove = () => {
    if (!auth.accessToken || !confirm) return;
    // Editable destination (§10.1): Stage select + leaf select win.
    const targetId = confirmLeaf ? Number(confirmLeaf) : confirm.toStatusId;
    if (!targetId) return;
    doMove(confirm.taskId, confirm.fromStatusId, confirm.fromName, confirm.taskTitle, targetId);
  };

  const deleteTask = (taskId: number) => {
    if (!auth.accessToken) return;
    fetch(`/api/v1/tasks/${taskId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${auth.accessToken}` },
    })
      .then((r) => {
        if (!r.ok) throw new Error(`Delete failed: ${r.status}`);
        setDeleteTarget(null);
        setCtxMenu(null);
        setRefreshKey((k) => k + 1);
      })
      .catch((e) => setError(e.message));
  };

  const undoMove = () => {
    if (!auth.accessToken || !toast) return;
    fetch(`/api/v1/tasks/${toast.taskId}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth.accessToken}` },
      body: JSON.stringify({ status_id: toast.fromStatusId }),
    })
      .then((r) => {
        if (!r.ok) throw new Error(`Undo failed: ${r.status}`);
        return r.json();
      })
      .then(() => {
        setToast(null);
        if (toastTimer.current) window.clearTimeout(toastTimer.current);
        setRefreshKey((k) => k + 1);
      })
      .catch((e) => setError(e.message));
  };

  // ---- Context-aware Add Task (kan2 §13) ----

  const resolveCreateProject = (): string | number | null => {
    if (!isCategoryMode) return scopeId;
    if (projectFilter) return projectFilter;
    const first = projects[0];
    return first ? first.id : null;
  };

  const openCreate = (statusId: number) => {
    const pid = resolveCreateProject();
    if (pid == null || pid === "") {
      setError("No project available for task creation in this view.");
      return;
    }
    setCreate({ projectId: pid, statusId });
  };

  const openCtx = (t: KanbanTask, x: number, y: number) => {
    setCtxMenu({ taskId: t.id, projectId: t.project_id, depth: t.depth, title: t.title, x, y });
  };

  /** kan2 §29 — cap cards per list; "Show more" expands (per-list key). */
  const limitRows = (rows: KanbanTask[], key: string) =>
    showAll[key] ? rows : rows.slice(0, COL_CARD_LIMIT);

  const renderCard = (t: KanbanTask) => {
    const st = statusById.get(t.status_id);
    const sig = signalByStatus.get(t.status_id);
    const proj = projectById.get(t.project_id);
    const projColor = proj?.color || "#6b7280";
    const kind = st?.kind ?? "normal";
    const isSource = dragId === t.id;
    const dragProps = {
      draggable: canDrag,
      onDragStart: (e: React.DragEvent) => {
        setDragId(t.id);
        e.dataTransfer.effectAllowed = "move";
        try {
          e.dataTransfer.setData("text/plain", String(t.id));
        } catch {
          // some browsers restrict data during dragstart
        }
      },
      onDragEnd: () => {
        setDragId(null);
        setDragOverStageId(null);
        closeBucket();
      },
      onContextMenu: (e: React.MouseEvent) => {
        e.preventDefault();
        openCtx(t, e.clientX, e.clientY);
      },
    };
    const frame = `rounded-lg border bg-white shadow-sm cursor-grab hover:shadow ${
      t.is_blocked || kind === "blocked" ? "border-rose-300 ring-1 ring-rose-200" : "border-slate-200"
    } ${isSource ? "opacity-50 ring-2 ring-slate-300" : ""}`;
    // kan2 §20.3 — ultra compact: title + essential indicator only.
    if (density === "ultra") {
      return (
        <article
          key={t.id}
          {...dragProps}
          className={`${frame} px-2 py-1 text-xs flex items-center gap-1.5`}
          style={{ borderLeft: `4px solid ${projColor}` }}
          title={`${t.wbs || `#${t.id}`} · ${st?.name ?? t.status_id} — right-click for actions`}
        >
          <span className={`font-mono ${signalClass(kind, !!st?.is_done)}`} title={sig?.label}>
            {sig?.glyph}
          </span>
          <button
            onClick={() => setEdit({ id: t.id, projectId: t.project_id })}
            className="flex-1 truncate text-left font-medium text-slate-900 hover:text-blue-700 hover:underline"
            title="Edit task"
          >
            {t.title}
          </button>
          {sig?.milestone && <span title="Milestone">★</span>}
          {(t.is_blocked || kind === "blocked") && <span title="Blocked">⛔</span>}
        </article>
      );
    }
    // kan2 §20.2 — compact: reduced single-row info.
    if (density === "compact") {
      return (
        <article
          key={t.id}
          {...dragProps}
          className={`${frame} px-2 py-1.5 text-xs flex items-center gap-2`}
          style={{ borderLeft: `4px solid ${projColor}` }}
          title={`${t.wbs || `#${t.id}`} · ${st?.name ?? t.status_id} — right-click for actions`}
        >
          <button
            onClick={() => setEdit({ id: t.id, projectId: t.project_id })}
            className="flex-1 truncate text-left font-medium text-slate-900 hover:text-blue-700 hover:underline"
            title="Edit task"
          >
            {t.title}
          </button>
          <span className={`font-mono text-[11px] shrink-0 ${signalClass(kind, !!st?.is_done)}`} title={sig?.label}>
            {sig?.glyph}
          </span>
          <span className="font-mono text-[10px] text-slate-500 shrink-0">
            {t.priority === "urgent" ? "P0" : t.priority === "high" ? "P1" : t.priority === "low" ? "P3" : "P2"}
          </span>
          {sig?.milestone && <span title="Milestone">★</span>}
        </article>
      );
    }
    return (
      <article
        key={t.id}
        {...dragProps}
        className={`${frame} p-2.5 text-xs`}
        style={{ borderLeft: `4px solid ${projColor}` }}
        title={canDrag ? "Drag to another column to change Status · right-click for actions" : "Guests cannot move tasks"}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[11px] text-slate-500">
            {t.wbs || `#${t.id}`} · {st?.name ?? t.status_id}
          </span>
          <span className={`font-mono text-[11px] ${signalClass(kind, !!st?.is_done)}`} title={sig?.label}>
            {sig?.glyph} {sig?.weight}%{sig?.milestone ? " ★" : ""}
          </span>
        </div>
        <button
          onClick={() => setEdit({ id: t.id, projectId: t.project_id })}
          className="mt-1 text-left font-medium text-slate-900 hover:text-blue-700 hover:underline"
          title="Edit task"
        >
          {t.title}
        </button>
        <div className="mt-1 font-mono text-[11px] text-slate-500">
          {t.start_date} → {t.due_date ?? "no due"}
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1 text-[11px]">
          {isCategoryMode && proj && (
            <span
              className="px-1.5 py-0.5 rounded border font-mono font-semibold"
              style={{ backgroundColor: `${projColor}14`, color: projColor, borderColor: `${projColor}55` }}
            >
              {proj.code}
            </span>
          )}
          {t.assignee_ids.length > 0 && (
            <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-mono">
              {t.assignee_ids.length} assignee(s)
            </span>
          )}
          {t.tag_names.slice(0, 3).map((tag) => (
            <span key={tag} className="px-1.5 py-0.5 rounded bg-slate-50 border border-slate-200 text-slate-500">
              {tag}
            </span>
          ))}
          {(t.is_blocked || kind !== "normal" || st?.is_done) && (
            <span className="px-1.5 py-0.5 rounded bg-amber-50 border border-amber-200 text-amber-700">
              {st?.is_done ? "✓ done" : kindLabel(kind, false)}
            </span>
          )}
        </div>
      </article>
    );
  };

  const dragSourceStatusId = dragId != null
    ? (visibleTasks.find((x) => x.id === dragId) ?? tasks.find((x) => x.id === dragId))?.status_id ?? null
    : null;

  const renderLeafChips = (
    leaves: { status: StatusInfo; rows: KanbanTask[] }[],
    stageId: number,
    compact = false
  ) => (
    <div className={`flex flex-wrap gap-1.5 ${compact ? "" : "mt-2 border-t border-slate-100 pt-2"}`}>
      {leaves.map(({ status, rows }) => {
        const sig = signalByStatus.get(status.id);
        const empty = rows.length === 0;
        // kan2 §23.1 — dropping onto the source Status is invalid.
        const invalid = dragId != null && dragSourceStatusId === status.id;
        return (
          <button
            key={status.id}
            onClick={() => openStatusPopup(status.id)}
            onDragOver={(e) => {
              if (dragId != null) {
                e.preventDefault();
                e.dataTransfer.dropEffect = invalid ? "none" : "move";
              }
            }}
            onDrop={() => {
              if (dragId != null && !invalid) {
                requestMove(dragId, status.id, stageId);
                setDragId(null);
              }
            }}
            title={`${status.name} · ${rows.length} item(s) — click for list, drop here to move${invalid ? " (current status — drop not permitted)" : ""}`}
            className={`px-2 py-1 rounded-full border text-[11px] font-mono flex items-center gap-1 hover:shadow-sm ${
              invalid
                ? "bg-rose-50 text-rose-400 border-rose-300 cursor-not-allowed"
                : empty
                  ? "bg-white text-slate-400 border-dashed border-slate-300"
                  : "bg-slate-50 text-slate-600 border-slate-200"
            } ${bucketLeaf === status.id && !invalid ? "ring-2 ring-blue-400" : ""}`}
          >
            <span className={signalClass(status.kind ?? "normal", !!status.is_done)}>
              {sig?.glyph ?? "○"}
            </span>
            <span className="max-w-28 truncate">{status.name}</span>
            <span>({rows.length})</span>
          </button>
        );
      })}
    </div>
  );

  const bucketStage = bucket ? stageGroups.find((g) => g.stage.id === bucket.stageId) : null;
  const bucketLeaves = useMemo(() => {
    if (!bucketStage) return [];
    const q = bucketSearch.trim().toLowerCase();
    const all = [...bucketStage.leaves].sort((a, b) => a.status.order - b.status.order);
    if (!q) return all;
    return all.filter(
      (l) =>
        l.status.name.toLowerCase().includes(q) ||
        bucketStage.stage.name.toLowerCase().includes(q)
    );
  }, [bucketStage, bucketSearch]);
  const bucketNeedsSearch = (bucketStage?.leaves.length ?? 0) > BUCKET_SEARCH_THRESHOLD;

  // Clamp bucket overlay inside the viewport (kan2 §24).
  const bucketPos = bucket
    ? {
        left: Math.max(8, Math.min(bucket.x + 14, window.innerWidth - 300)),
        top: Math.max(8, Math.min(bucket.y + 14, window.innerHeight - 340)),
      }
    : null;

  return (
    <main className="p-6 bg-slate-50 min-h-screen text-slate-900">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Kanban</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {isCategoryMode ? "Category" : "Project"}: {scopeName} · {visibleTasks.length} items ·{" "}
            {viewMode === "expanded" ? "Expanded Status view" : "Standard Stage view"} · middle-drag pans horizontal,
            Ctrl+middle-drag pans vertical
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs flex-wrap">
          <div className="flex items-center gap-1 bg-white rounded-lg p-1 border border-slate-200 shadow-sm">
            <span className="px-2 text-slate-500">View:</span>
            <button
              onClick={() => setViewMode("standard")}
              className={`px-2.5 py-1 rounded font-medium ${viewMode === "standard" ? "bg-slate-900 text-white" : "text-slate-500"}`}
            >
              Standard
            </button>
            <button
              onClick={() => setViewMode("expanded")}
              className={`px-2.5 py-1 rounded font-medium ${viewMode === "expanded" ? "bg-slate-900 text-white" : "text-slate-500"}`}
            >
              Expand All
            </button>
            <button
              onClick={() => {
                setViewMode("standard");
                setExpandedStages({});
              }}
              className="px-2.5 py-1 rounded font-medium text-slate-500 hover:text-slate-900"
              title="Collapse all stages to Standard view"
            >
              Collapse All
            </button>
          </div>
          <div
            className="flex items-center gap-1 bg-white rounded-lg p-1 border border-slate-200 shadow-sm"
            title="Information density (kan2 §20) — persisted per profile"
          >
            <span className="px-2 text-slate-500">Density:</span>
            {(["comfortable", "compact", "ultra"] as Density[]).map((d) => (
              <button
                key={d}
                onClick={() => setDensity(d)}
                className={`px-2.5 py-1 rounded font-medium capitalize ${density === d ? "bg-slate-900 text-white" : "text-slate-500"}`}
                title={d === "comfortable" ? "Rich cards" : d === "compact" ? "Reduced rows" : "Title only"}
              >
                {d === "comfortable" ? "Comfort" : d === "compact" ? "Compact" : "Ultra"}
              </button>
            ))}
          </div>
          <label
            className="flex items-center gap-1 bg-white rounded-lg px-2 py-1 border border-slate-200 shadow-sm"
            title="When to confirm drag-and-drop moves (kan2 §10.2)"
          >
            <span className="text-slate-500">Confirm:</span>
            <select
              aria-label="confirmation rule"
              className="h-7 text-[12px] bg-transparent"
              value={confirmMode}
              onChange={(e) => setConfirmMode(e.target.value as ConfirmMode)}
            >
              <option value="always">Always</option>
              <option value="stage-change">Stage change only</option>
              <option value="done-only">Done/milestone only</option>
              <option value="never">Never</option>
            </select>
          </label>
          <button
            onClick={() => setNavVisible((v) => !v)}
            className="px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 shadow-sm font-medium text-slate-500 hover:text-slate-900"
            aria-pressed={navVisible}
            title="Toggle workflow navigator (kan2 §17)"
          >
            {navVisible ? "Hide Navigator" : "Navigator"}
          </button>
          {isCategoryMode && projects.length > 0 && (
            <select
              aria-label="filter by project"
              className="h-9 px-2 rounded-lg bg-white text-[13px] border border-slate-200"
              value={projectFilter}
              onChange={(e) => setProjectFilter(e.target.value)}
            >
              <option value="">All projects</option>
              {projects.map((p) => (
                <option key={p.id} value={String(p.id)}>
                  {p.code} · {p.name}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      <TaskFilters
        filters={filters}
        onChange={setFilters}
        statuses={statuses.map((s) => ({ id: s.id, name: s.name, stage_id: s.stage_id ?? null }))}
        stages={stages.map((s) => ({ id: s.id, name: s.name }))}
      />
      {(filtersActive || filters.stageId) && (
        <div className="mt-2 text-[11px] font-mono px-3 py-1.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 inline-flex gap-2 items-center">
          <span className="font-bold uppercase tracking-wide">Filtered View</span>
          <span>
            Showing {visibleTasks.length} of {tasks.length} Tasks
          </span>
        </div>
      )}
      {loading && (
        <div role="status" className="mt-3 text-xs text-slate-500">
          Loading kanban…
        </div>
      )}
      {error && (
        <div role="alert" className="mt-3 text-xs text-red-600">
          {error}
        </div>
      )}

      {/* kan2 §19 — milestone lane: flagged Statuses as ◆ checkpoints, no column width. */}
      {statuses.some((s) => s.is_milestone) && (
        <div
          className="mt-3 flex items-center gap-2 overflow-x-auto px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-[11px]"
          aria-label="Milestones"
          title="Milestone checkpoints across the workflow (★ flagged Statuses)"
        >
          <span className="font-bold uppercase tracking-wide text-slate-500 shrink-0">◆ Milestones:</span>
          {stages.map((st) => {
            const ms = statuses
              .filter((s) => s.stage_id === st.id && s.is_milestone)
              .sort((a, b) => a.order - b.order);
            if (ms.length === 0) return null;
            return (
              <span key={st.id} className="flex items-center gap-1 shrink-0">
                <span
                  className="w-2 h-2 rotate-45 inline-block shrink-0"
                  style={{ backgroundColor: st.color_base || "#6b7280" }}
                />
                <span className="font-mono text-slate-500">{st.name}:</span>
                {ms.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => openStatusPopup(m.id)}
                    className="font-medium text-slate-700 hover:text-blue-700 hover:underline"
                    title={`Milestone ${m.name} in ${st.name} — click for items`}
                  >
                    ★ {m.name}
                  </button>
                ))}
              </span>
            );
          })}
        </div>
      )}

      {/* kan2 §17 — workflow navigator / minimap. */}
      {navVisible && stageGroups.length > 0 && (
        <div
          className="mt-3 flex items-center gap-1 px-3 py-2 rounded-lg bg-white border border-slate-200 overflow-x-auto"
          aria-label="Workflow navigator"
          title="Workflow navigator — click a Stage to jump the viewport"
        >
          <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400 shrink-0 mr-1">Flow</span>
          {stageGroups.map((g, i) => {
            const inView = visibleStages.includes(g.stage.id);
            const hasMs = g.leaves.some((l) => l.status.is_milestone);
            return (
              <button
                key={g.stage.id}
                onClick={() => scrollToStage(g.stage.id)}
                title={`${i + 1}. ${g.stage.name} · ${g.flat.length} items${hasMs ? " · ★ milestone" : ""}${inView ? " · in view" : ""}`}
                className={`shrink-0 px-2 py-1 rounded border text-[11px] font-mono flex items-center gap-1 ${
                  inView ? "border-blue-400 bg-blue-50 text-blue-800 font-bold" : "border-slate-200 text-slate-500 hover:bg-slate-50"
                }`}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ backgroundColor: g.stage.color_base || "#6b7280" }}
                />
                [{String(i + 1).padStart(2, "0")}] {g.stage.name}
                <span>({g.flat.length})</span>
                {hasMs && <span title="Contains milestone">★</span>}
              </button>
            );
          })}
        </div>
      )}

      <div className="relative">
        {/* kan2 §16 — edge gradients + hidden-status indicators. */}
        {edge.left > 0 && <div className="pointer-events-none absolute left-0 top-0 bottom-4 w-8 z-20 bg-gradient-to-r from-slate-300/60 to-transparent" />}
        {edge.right > 0 && <div className="pointer-events-none absolute right-0 top-0 bottom-4 w-8 z-20 bg-gradient-to-l from-slate-300/60 to-transparent" />}
        {edge.left > 0 && (
          <button
            onClick={() => scrollByStages(-1)}
            className="absolute left-1 top-1/2 -translate-y-1/2 z-30 w-8 h-8 rounded-full bg-white border border-slate-300 shadow font-mono text-sm text-slate-600 hover:bg-slate-50"
            title={`${edge.left} status(es) hidden left — click to scroll`}
            aria-label={`${edge.left} hidden left`}
          >
            ◀<span className="text-[10px] ml-0.5">{edge.left}</span>
          </button>
        )}
        {edge.right > 0 && (
          <button
            onClick={() => scrollByStages(1)}
            className="absolute right-1 top-1/2 -translate-y-1/2 z-30 w-8 h-8 rounded-full bg-white border border-slate-300 shadow font-mono text-sm text-slate-600 hover:bg-slate-50"
            title={`${edge.right} status(es) hidden right — click to scroll`}
            aria-label={`${edge.right} hidden right`}
          >
            <span className="text-[10px] mr-0.5">{edge.right}</span>▶
          </button>
        )}
      <div
        ref={scrollRef}
        onScroll={updateEdges}
        onDragOver={handleBoardDragOver}
        className="mt-4 flex gap-3 overflow-auto pb-4 items-stretch"
        style={{ maxHeight: "72vh" }}
        title="Middle-drag to pan horizontally, Ctrl+middle-drag to pan vertically"
      >
        {stageGroups.map((g) => {
          const expanded = isExpanded(g.stage.id);
          const pct = g.flat.length > 0 ? Math.round((g.done / g.flat.length) * 100) : 0;
          const stageColor = g.stage.color_base || "#6b7280";
          const isEmpty = g.flat.length === 0;
          // kan2 §4: empty Stages collapse to rails unless explicitly expanded (§5).
          const showRail = isEmpty && !expandedStages[g.stage.id] && viewMode !== "expanded";
          const draggingOver = dragOverStageId === g.stage.id && dragId != null;

          if (showRail) {
            return (
              <section
                key={g.stage.id}
                data-stage-id={g.stage.id}
                onDragEnter={(e) => handleStageDragOver(e, g.stage.id)}
                onDragOver={(e) => handleStageDragOver(e, g.stage.id)}
                onDragLeave={handleStageDragLeave}
                onDrop={() => {
                  if (dragId != null) requestStageDrop(dragId, g.stage.id, bucketLeaf ?? undefined);
                  setDragId(null);
                }}
                className={`shrink-0 rounded-xl border bg-white shadow-sm overflow-hidden flex flex-col items-center py-2 gap-2 ${
                  draggingOver ? "border-blue-400 ring-2 ring-blue-200" : "border-slate-200"
                }`}
                style={{ width: 52, borderTop: `4px solid ${stageColor}`, minHeight: 220 }}
                title={`${g.stage.name} · empty — hover for actions, drop here to move`}
              >
                <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: stageColor }} />
                <button
                  onClick={() => openStagePopup(g.stage.id)}
                  className="text-[11px] font-bold text-slate-600 hover:text-slate-900"
                  style={{ writingMode: "vertical-rl" }}
                  title={`${g.stage.name} · 0 items — click for list`}
                >
                  {g.stage.name.toUpperCase()}
                </button>
                <span className="font-mono text-[10px] text-slate-400">(0)</span>
                {draggingOver && (
                  <span className="text-[10px] text-blue-600 font-bold" title="Hold 1s for destinations">
                    ▾
                  </span>
                )}
                {canCreate && (
                  <button
                    onClick={() => {
                      const first = statuses
                        .filter((s) => s.stage_id === g.stage.id)
                        .sort((a, b) => a.order - b.order)[0];
                      if (first) openCreate(first.id);
                    }}
                    className="mt-auto w-7 h-7 rounded-full border border-slate-200 text-slate-500 hover:bg-slate-100 text-sm leading-none"
                    title={`Add Task in ${g.stage.name}`}
                  >
                    +
                  </button>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleStage(g.stage.id);
                  }}
                  className="text-[10px] text-slate-400 hover:text-slate-700"
                  title="Expand empty stage"
                >
                  ▸
                </button>
              </section>
            );
          }

          const filled = g.leaves.filter((l) => l.rows.length > 0);
          const emptyLeaves = g.leaves.filter((l) => l.rows.length === 0);

          return (
            <section
              key={g.stage.id}
              data-stage-id={g.stage.id}
              onDragEnter={(e) => {
                if (!expanded) handleStageDragOver(e, g.stage.id);
              }}
              onDragOver={(e) => {
                if (!expanded) handleStageDragOver(e, g.stage.id);
              }}
              onDragLeave={() => {
                if (!expanded) handleStageDragLeave();
              }}
              onDrop={() => {
                if (!expanded && dragId != null) {
                  requestStageDrop(dragId, g.stage.id, bucketLeaf ?? undefined);
                  setDragId(null);
                }
              }}
              className={`rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden flex flex-col ${
                expanded ? "shrink-0" : "flex-1"
              } ${draggingOver && !expanded ? "ring-2 ring-blue-200 border-blue-300" : ""}`}
              style={{
                // kan2 §3: populated Stages share width (~1/6 viewport target);
                // fixed min keeps readability, flex keeps board stable on drag.
                flex: expanded ? `0 0 auto` : "1 1 0",
                minWidth: expanded ? undefined : 250,
                width: expanded ? Math.max(filled.length, 1) * 296 + 32 : undefined,
                borderTop: `4px solid ${stageColor}`,
              }}
            >
              <header
                className="px-3 py-2.5 cursor-pointer hover:bg-slate-50 sticky top-0 z-10 bg-white"
                style={{ backgroundColor: `${stageColor}0d` }}
                onClick={() => openStagePopup(g.stage.id)}
                title={`Show all items in ${g.stage.name}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: stageColor }} />
                    <strong className="text-sm truncate">{g.stage.name}</strong>
                    {draggingOver && !expanded && (
                      <span className="text-[11px] text-blue-600 font-bold" title="Hold 1s for Tier-2 destinations">
                        ▾
                      </span>
                    )}
                  </span>
                  <span className="font-mono text-[11px] text-slate-500 shrink-0">
                    {g.flat.length} · {pct}% done
                  </span>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <div className="flex-1 h-1.5 rounded bg-slate-100 overflow-hidden" title={`${pct}% done`}>
                    <div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} />
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleStage(g.stage.id);
                    }}
                    className="px-2 py-0.5 rounded bg-white border border-slate-200 text-[11px] font-medium hover:bg-slate-100"
                    aria-expanded={expanded}
                  >
                    {expanded ? "Collapse ▴" : "Expand ▾"}
                  </button>
                </div>
              </header>

              {!expanded ? (
                <div className="p-2.5 min-h-40 flex flex-col">
                  <div className="space-y-2 max-h-[44vh] overflow-y-auto pr-0.5" style={{ contentVisibility: "auto" }}>
                    {limitRows(g.flat, `stage:${g.stage.id}`).map(renderCard)}
                    {g.flat.length > COL_CARD_LIMIT && !showAll[`stage:${g.stage.id}`] && (
                      <button
                        onClick={() => setShowAll((p) => ({ ...p, [`stage:${g.stage.id}`]: true }))}
                        className="w-full py-1.5 text-[11px] font-mono text-blue-700 hover:underline"
                      >
                        Show {g.flat.length - COL_CARD_LIMIT} more…
                      </button>
                    )}
                    {g.flat.length === 0 && (
                      <div className="py-8 text-center text-slate-400 text-xs">No items — drop here to move.</div>
                    )}
                  </div>
                  {g.leaves.length > 0 && renderLeafChips(g.leaves, g.stage.id)}
                  {canCreate && (
                    <button
                      onClick={() => {
                        const first = [...g.leaves].sort((a, b) => a.status.order - b.status.order)[0];
                        if (first) openCreate(first.status.id);
                      }}
                      className="mt-2 w-full py-2 rounded-lg border border-dashed border-slate-300 text-xs text-slate-500 hover:bg-slate-50 hover:text-slate-800 font-medium"
                      title={`Add Task in ${g.stage.name} (inherits Stage)`}
                    >
                      + Add Task
                    </button>
                  )}
                </div>
              ) : (
                <div className="p-2.5">
                  <div className="flex gap-3">
                    {filled.map(({ status, rows }) => {
                      const sig = signalByStatus.get(status.id);
                      const shade = status.shade || status.color || stageColor;
                      return (
                        <section
                          key={status.id}
                          onDragOver={(e) => {
                            if (dragId != null) {
                              e.preventDefault();
                              e.dataTransfer.dropEffect = dragSourceStatusId === status.id ? "none" : "move";
                            }
                          }}
                          onDrop={() => {
                            if (dragId != null && dragSourceStatusId !== status.id) requestMove(dragId, status.id, g.stage.id);
                            setDragId(null);
                          }}
                          className={`w-72 shrink-0 rounded-lg border bg-slate-50/60 flex flex-col max-h-[58vh] ${
                            dragId != null && dragSourceStatusId === status.id
                              ? "border-rose-300 opacity-70"
                              : "border-slate-200"
                          }`}
                        >
                          <header
                            className="px-2.5 py-2 border-b border-slate-200 text-[13px] font-semibold flex justify-between items-center gap-2 cursor-pointer hover:bg-white rounded-t-lg sticky top-0 z-10 bg-slate-50"
                            onClick={() => openStatusPopup(status.id)}
                            title={`Show items in ${status.name}`}
                          >
                            <span className="flex items-center gap-1.5 truncate">
                              <span className="w-2.5 h-2.5 rounded shrink-0" style={{ backgroundColor: shade }} />
                              <span className="truncate">{status.name}</span>
                              <span className={`font-mono text-[11px] font-normal shrink-0 ${signalClass(status.kind ?? "normal", !!status.is_done)}`}>
                                {sig?.glyph} {sig?.weight}%{sig?.milestone ? " ★" : ""}
                              </span>
                            </span>
                            <span className="text-slate-500 font-mono text-xs">{rows.length}</span>
                          </header>
                          <div className="p-2 space-y-2 overflow-y-auto" style={{ contentVisibility: "auto" }}>
                            {limitRows(rows, `leaf:${status.id}`).map(renderCard)}
                            {rows.length > COL_CARD_LIMIT && !showAll[`leaf:${status.id}`] && (
                              <button
                                onClick={() => setShowAll((p) => ({ ...p, [`leaf:${status.id}`]: true }))}
                                className="w-full py-1 text-[11px] font-mono text-blue-700 hover:underline"
                              >
                                Show {rows.length - COL_CARD_LIMIT} more…
                              </button>
                            )}
                          </div>
                          {canCreate && (
                            <button
                              onClick={() => openCreate(status.id)}
                              className="m-2 mt-0 py-1.5 rounded-lg border border-dashed border-slate-300 text-[11px] text-slate-500 hover:bg-white font-medium"
                              title={`Add Task in ${g.stage.name} > ${status.name}`}
                            >
                              + Add Task
                            </button>
                          )}
                        </section>
                      );
                    })}
                    {filled.length === 0 && (
                      <div className="py-6 px-4 text-xs text-slate-400">No items yet — use + Add Task below.</div>
                    )}
                  </div>
                  {emptyLeaves.length > 0 && (
                    <div className="mt-2 border-t border-slate-100 pt-2">
                      <div className="text-[10px] font-mono uppercase tracking-wide text-slate-400 mb-1">
                        Empty statuses
                      </div>
                      {renderLeafChips(emptyLeaves, g.stage.id, true)}
                    </div>
                  )}
                  {canCreate && filled.length === 0 && emptyLeaves.length > 0 && (
                    <button
                      onClick={() => openCreate(emptyLeaves[0].status.id)}
                      className="mt-2 w-full py-2 rounded-lg border border-dashed border-slate-300 text-xs text-slate-500 hover:bg-slate-50 font-medium"
                    >
                      + Add Task
                    </button>
                  )}
                  {g.leaves.length === 0 && (
                    <div className="py-6 px-4 text-xs text-slate-400">No leaf Statuses in this Stage yet.</div>
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>
      </div>

      {visibleTasks.length === 0 && !loading && !error && (
        <div className="text-center text-slate-400 text-sm py-10">No items match the current filters.</div>
      )}
      {statusById.size === 0 && !loading && (
        <div className="text-center text-slate-400 text-xs py-4">No Statuses in this Category profile yet.</div>
      )}

      {/* Temporary Drop Bucket overlay (kan2 §7) — never alters layout (§32). */}
      {bucket && bucketStage && bucketPos && dragId != null && (
        <div
          role="dialog"
          aria-label={`Select destination in ${bucketStage.stage.name}`}
          className="fixed z-50 w-72 rounded-xl border border-slate-300 bg-white shadow-2xl overflow-hidden"
          style={{ left: bucketPos.left, top: bucketPos.top }}
          onDragEnter={() => setBucketHover(true)}
          onDragLeave={() => {
            setBucketHover(false);
            handleStageDragLeave();
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (dragId != null) {
              requestStageDrop(dragId, bucketStage.stage.id, bucketLeaf ?? undefined);
              setDragId(null);
            }
          }}
        >
          <header className="px-3 py-2 border-b border-slate-200 bg-slate-50">
            <div className="text-[13px] font-bold uppercase tracking-wide truncate">
              {bucketStage.stage.name}
            </div>
            <div className="text-[11px] text-slate-500">Select destination — drop onto a status</div>
          </header>
          {bucketNeedsSearch && (
            <div className="px-2.5 pt-2">
              <input
                autoFocus
                value={bucketSearch}
                onChange={(e) => setBucketSearch(e.target.value)}
                placeholder="Search status..."
                className="w-full h-8 px-2 rounded-lg border border-slate-200 text-xs"
                aria-label="Search destination status"
              />
            </div>
          )}
          <div className="p-1.5 max-h-64 overflow-y-auto">
            {bucketLeaves.map(({ status, rows }) => {
              const sig = signalByStatus.get(status.id);
              const selected = bucketLeaf === status.id;
              const invalid = dragSourceStatusId === status.id;
              return (
                <div
                  key={status.id}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    e.dataTransfer.dropEffect = invalid ? "none" : "move";
                    if (bucketLeaf !== status.id) setBucketLeaf(status.id);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (dragId != null && !invalid) {
                      requestMove(dragId, status.id, bucketStage.stage.id, bucketStage.leaves.map((l) => l.status));
                      setDragId(null);
                    }
                  }}
                  className={`w-full text-left px-2.5 py-2 rounded-lg flex items-center gap-2 text-xs border ${
                    invalid
                      ? "border-rose-200 bg-rose-50/50 text-rose-400 cursor-not-allowed"
                      : selected
                        ? "bg-blue-50 border-blue-300 ring-1 ring-blue-200 cursor-pointer"
                        : "border-transparent hover:bg-slate-50 cursor-pointer"
                  }`}
                  title={invalid ? `${status.name} (current status — drop not permitted)` : `Move to ${status.name}`}
                >
                  <span className={`font-mono ${signalClass(status.kind ?? "normal", !!status.is_done)}`}>
                    ○
                  </span>
                  <span className="flex-1 truncate font-medium">{status.name}</span>
                  <span className="font-mono text-[11px] text-slate-400">
                    {sig?.glyph} {rows.length}
                    {sig?.milestone ? " ★" : ""}
                  </span>
                </div>
              );
            })}
            {bucketLeaves.length === 0 && (
              <div className="px-3 py-6 text-center text-xs text-slate-400">No matching statuses.</div>
            )}
          </div>
          <footer className="px-3 py-1.5 border-t border-slate-100 flex justify-between items-center">
            <span className="text-[10px] font-mono text-slate-400">overlay only · layout unchanged</span>
            <button
              onClick={closeBucket}
              className="text-[11px] text-slate-500 hover:text-slate-800 font-medium"
            >
              Close
            </button>
          </footer>
        </div>
      )}

      {popup && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={() => setPopup(null)}
          role="dialog"
          aria-modal="true"
          aria-label={popup.title}
        >
          <div
            className="w-full max-w-2xl max-h-[80vh] flex flex-col rounded-xl bg-white shadow-xl border border-slate-200"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-sm font-bold truncate">{popup.title}</h2>
                <p className="text-[11px] font-mono text-slate-500">{popup.subtitle}</p>
              </div>
              <button
                onClick={() => setPopup(null)}
                className="px-2.5 py-1 rounded border border-slate-200 text-xs hover:bg-slate-100"
              >
                Close
              </button>
            </header>
            <div className="overflow-y-auto divide-y divide-slate-100">
              {popupRows.map((t) => {
                const proj = projectById.get(t.project_id);
                return (
                  <button
                    key={t.id}
                    onClick={() => {
                      setPopup(null);
                      setEdit({ id: t.id, projectId: t.project_id });
                    }}
                    className="w-full text-left px-4 py-2.5 hover:bg-slate-50 flex items-center gap-3 text-sm"
                    title="Open task"
                  >
                    <span className="font-mono text-xs text-slate-500 w-20 shrink-0">{t.wbs || `#${t.id}`}</span>
                    <span className="flex-1 truncate font-medium">{t.title}</span>
                    {isCategoryMode && (
                      <span className="font-mono text-[11px] text-slate-500 w-24 truncate shrink-0">
                        {proj?.code ?? `P${t.project_id}`}
                      </span>
                    )}
                    <span className="font-mono text-[11px] text-slate-500 w-20 shrink-0 text-right">
                      {t.due_date ?? "—"}
                    </span>
                  </button>
                );
              })}
              {popupRows.length === 0 && (
                <div className="px-4 py-8 text-center text-slate-400 text-sm">No items under this status.</div>
              )}
            </div>
          </div>
        </div>
      )}

      {confirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          role="alertdialog"
          aria-modal="true"
          aria-label="Confirm status change"
        >
          <div className="w-full max-w-md rounded-xl bg-white shadow-xl border border-slate-200 p-4">
            <h2 className="text-sm font-bold">Move Task</h2>
            <p className="mt-1 text-xs text-slate-500">Confirm the destination before saving (kan2 §10).</p>
            <dl className="mt-3 text-sm space-y-1.5">
              <div className="flex gap-2">
                <dt className="w-16 shrink-0 text-slate-500 text-xs pt-0.5">Task:</dt>
                <dd className="font-medium">{confirm.taskTitle}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-16 shrink-0 text-slate-500 text-xs pt-0.5">From:</dt>
                <dd className="font-mono text-xs">{confirm.fromName}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-16 shrink-0 text-slate-500 text-xs pt-0.5">To:</dt>
                <dd className="font-mono text-xs">
                  {confirmStage
                    ? `${stageLabel(Number(confirmStage), stages)} > ${statusById.get(Number(confirmLeaf))?.name ?? confirm.toName}`
                    : confirm.toName}
                </dd>
              </div>
            </dl>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <label className="block text-xs text-slate-500">
                Destination Stage
                <select
                  className="mt-1 w-full h-10 px-2 rounded-lg bg-slate-50 text-sm border border-slate-200 text-slate-900"
                  value={confirmStage}
                  onChange={(e) => {
                    const sid = e.target.value;
                    setConfirmStage(sid);
                    const leaves = statuses
                      .filter((s) => String(s.stage_id) === sid)
                      .sort((a, b) => a.order - b.order);
                    if (leaves.length > 0) setConfirmLeaf(String(leaves[0].id));
                  }}
                >
                  {stages.map((s) => (
                    <option key={s.id} value={String(s.id)}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs text-slate-500">
                Target Sub-status
                <select
                  className="mt-1 w-full h-10 px-2 rounded-lg bg-slate-50 text-sm border border-slate-200 text-slate-900"
                  value={confirmLeaf}
                  onChange={(e) => setConfirmLeaf(e.target.value)}
                >
                  {confirmStageLeaves.map((s) => (
                    <option key={s.id} value={String(s.id)}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-2 text-sm">
              <button
                onClick={() => setConfirm(null)}
                className="px-4 py-2 rounded-lg border border-slate-200 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                onClick={submitMove}
                autoFocus
                className="px-4 py-2 rounded-lg bg-slate-900 text-white hover:bg-slate-700 font-semibold"
              >
                Move Task
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div
          role="status"
          className="fixed bottom-6 right-6 z-50 max-w-sm rounded-xl border border-slate-200 bg-white shadow-xl px-4 py-3 flex items-center gap-3"
        >
          <div className="min-w-0">
            <div className="text-xs font-bold truncate">Task moved to {toast.toName}</div>
            <div className="text-[11px] font-mono text-slate-500 truncate">
              {toast.taskTitle} · was {toast.fromName}
            </div>
          </div>
          <button
            onClick={undoMove}
            className="ml-2 px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-bold shrink-0 hover:bg-slate-700"
          >
            UNDO
          </button>
          <button
            onClick={() => {
              setToast(null);
              if (toastTimer.current) window.clearTimeout(toastTimer.current);
            }}
            className="text-slate-400 hover:text-slate-700 text-sm px-1"
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}

      {edit && (
        <TaskDialog
          projectId={edit.projectId}
          mode="edit"
          taskId={edit.id}
          onClose={() => setEdit(null)}
          onUpdated={() => setRefreshKey((k) => k + 1)}
        />
      )}

      {/* kan2 §14 — work-item context menu (right-click; no Add Child on Microtask). */}
      {ctxMenu && (
        <div className="fixed inset-0 z-50" onClick={() => setCtxMenu(null)} onContextMenu={(e) => { e.preventDefault(); setCtxMenu(null); }}>
          <div
            role="menu"
            aria-label={`Actions for ${ctxMenu.title}`}
            className="fixed w-52 rounded-xl border border-slate-200 bg-white shadow-2xl py-1 text-sm"
            style={{
              left: Math.max(8, Math.min(ctxMenu.x, window.innerWidth - 220)),
              top: Math.max(8, Math.min(ctxMenu.y, window.innerHeight - 300)),
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-3 py-1.5 border-b border-slate-100 mb-1">
              <div className="text-xs font-bold truncate">{ctxMenu.title}</div>
              <div className="text-[10px] font-mono text-slate-400">depth {ctxMenu.depth} · Microtask is leaf</div>
            </div>
            <button
              role="menuitem"
              className="w-full text-left px-3 py-1.5 hover:bg-slate-50"
              onClick={() => { const c = ctxMenu; setCtxMenu(null); setEdit({ id: c.taskId, projectId: c.projectId }); }}
            >
              Open
            </button>
            <button
              role="menuitem"
              className="w-full text-left px-3 py-1.5 hover:bg-slate-50"
              onClick={() => { const c = ctxMenu; setCtxMenu(null); setEdit({ id: c.taskId, projectId: c.projectId }); }}
            >
              Edit
            </button>
            {ctxMenu.depth < 2 && canCreate && (
              <button
                role="menuitem"
                className="w-full text-left px-3 py-1.5 hover:bg-slate-50"
                onClick={() => {
                  const c = ctxMenu;
                  const t = tasks.find((x) => x.id === c.taskId);
                  setCtxMenu(null);
                  setCreate({
                    projectId: c.projectId,
                    statusId: t?.status_id ?? statuses[0]?.id ?? 0,
                    initialParentId: c.taskId,
                    initialLevel: (c.depth + 1) as 0 | 1 | 2,
                  });
                }}
              >
                {ctxMenu.depth === 0 ? "Add Subtask" : "Add Microtask"}
              </button>
            )}
            {canDrag && (
              <button
                role="menuitem"
                className="w-full text-left px-3 py-1.5 hover:bg-slate-50"
                onClick={() => { const c = ctxMenu; setCtxMenu(null); setMoveTo({ taskId: c.taskId, title: c.title, q: "" }); }}
              >
                Move To…
              </button>
            )}
            {canDrag && (
              <button
                role="menuitem"
                className="w-full text-left px-3 py-1.5 hover:bg-rose-50 text-rose-700"
                onClick={() => { const c = ctxMenu; setCtxMenu(null); setDeleteTarget({ id: c.taskId, title: c.title }); }}
              >
                Delete
              </button>
            )}
          </div>
        </div>
      )}

      {/* kan2 §15 — Move To searchable selector (§28 keyboard-accessible alternative). */}
      {moveTo && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`Move ${moveTo.title}`}
          onClick={() => setMoveTo(null)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setMoveTo(null);
            if (e.key === "Enter") {
              const q = moveTo.q.trim().toLowerCase();
              const all = statuses.filter((s) => !q || s.name.toLowerCase().includes(q) || stageLabel(s.stage_id, stages).toLowerCase().includes(q));
              if (all[0]) {
                const m = moveTo;
                setMoveTo(null);
                requestMove(m.taskId, all[0].id, all[0].stage_id);
              }
            }
          }}
        >
          <div
            className="w-full max-w-lg max-h-[80vh] flex flex-col rounded-xl bg-white shadow-xl border border-slate-200"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="px-4 py-3 border-b border-slate-200">
              <h2 className="text-sm font-bold truncate">Move Task — {moveTo.title}</h2>
              <input
                autoFocus
                value={moveTo.q}
                onChange={(e) => setMoveTo({ ...moveTo, q: e.target.value })}
                placeholder="Search destination: stage or status…"
                aria-label="Search destination"
                className="mt-2 w-full h-10 px-3 rounded-lg border border-slate-200 text-sm"
              />
            </header>
            <div className="overflow-y-auto p-2">
              {stages.map((st) => {
                const q = moveTo.q.trim().toLowerCase();
                const leaves = statuses
                  .filter((s) => s.stage_id === st.id)
                  .filter((s) =>
                    !q || s.name.toLowerCase().includes(q) || st.name.toLowerCase().includes(q)
                  )
                  .sort((a, b) => a.order - b.order);
                if (q && leaves.length === 0) return null;
                if (!q && leaves.length === 0) return null;
                return (
                  <div key={st.id} className="mb-1">
                    <div className="px-2 pt-2 text-[11px] font-bold uppercase tracking-wide text-slate-500 flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: st.color_base || "#6b7280" }} />
                      {st.name}
                    </div>
                    {leaves.map((s) => {
                      const sig = signalByStatus.get(s.id);
                      const count = visibleTasks.filter((t) => t.status_id === s.id).length;
                      const invalid = (tasks.find((x) => x.id === moveTo.taskId)?.status_id ?? null) === s.id;
                      return (
                        <button
                          key={s.id}
                          disabled={invalid}
                          onClick={() => {
                            const m = moveTo;
                            setMoveTo(null);
                            requestMove(m.taskId, s.id, st.id);
                          }}
                          className={`w-full text-left px-3 py-2 rounded-lg flex items-center gap-2 text-sm ${
                            invalid ? "opacity-40 cursor-not-allowed" : "hover:bg-slate-50"
                          }`}
                          title={invalid ? `${s.name} (current status)` : `Move to ${st.name} > ${s.name}`}
                        >
                          <span className={`font-mono ${signalClass(s.kind ?? "normal", !!s.is_done)}`}>
                            {sig?.glyph ?? "○"}
                          </span>
                          <span className="flex-1 truncate">{s.name}</span>
                          {s.is_milestone && <span title="Milestone">★</span>}
                          <span className="font-mono text-[11px] text-slate-400">({count})</span>
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          role="alertdialog"
          aria-modal="true"
          aria-label="Delete task"
        >
          <div className="w-full max-w-sm rounded-xl bg-white shadow-xl border border-slate-200 p-4">
            <h2 className="text-sm font-bold">Delete task?</h2>
            <p className="mt-2 text-sm text-slate-600">
              “{deleteTarget.title}” and its children will be permanently removed. This cannot be undone.
            </p>
            <div className="mt-4 flex justify-end gap-2 text-sm">
              <button
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 rounded-lg border border-slate-200 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                onClick={() => deleteTask(deleteTarget.id)}
                className="px-4 py-2 rounded-lg bg-rose-600 text-white hover:bg-rose-500 font-semibold"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {create && (
        <TaskDialog
          projectId={create.projectId}
          mode="create"
          initialStatusId={create.statusId}
          initialParentId={create.initialParentId ?? null}
          initialLevel={create.initialLevel}
          onClose={() => setCreate(null)}
          onCreated={() => {
            setCreate(null);
            setRefreshKey((k) => k + 1);
          }}
        />
      )}
    </main>
  );
}
