import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import TelemetryBar from "../components/TelemetryBar";
import { useAuth } from "../stores/auth";
import TaskCreateModal from "../components/TaskCreateModal";
import TaskDialog from "../components/TaskDialog";
import TaskDrawer from "../components/TaskDrawer";
import { buildStatusSignalMap } from "../utils/statusSignals";
import {
  buildChildrenMap,
  getSubtreeTasks,
  getVisibleTreeTasks,
  getDescendantStats,
  getWbsNumber,
  canDropAsSiblings,
  getSiblingPosition,
  getReorderDisabledReason,
  formatReorderConfirm,
  type TreeTask,
} from "../utils/wbsTree";

interface StatusInfo {
  id: number;
  name: string;
  order?: number;
  stage_id?: number | null;
  kind?: string;
  is_done?: boolean;
  is_milestone?: boolean;
}

const STATUS_DOTS = [
  "bg-amber-500",
  "bg-indigo-500",
  "bg-sky-500",
  "bg-emerald-500",
  "bg-purple-500",
  "bg-rose-500",
  "bg-teal-500",
];

const AVATAR_BG = [
  "bg-primary-fixed text-primary",
  "bg-secondary-fixed text-secondary",
  "bg-tertiary-fixed text-tertiary",
  "bg-primary-fixed-dim text-primary",
];

function statusDot(statusId: number): string {
  return STATUS_DOTS[Math.abs(statusId) % STATUS_DOTS.length];
}

function avatarBg(id: number): string {
  return AVATAR_BG[Math.abs(id) % AVATAR_BG.length];
}

function initials(display: string, fallbackId: number): string {
  const parts = display.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return `U${fallbackId}`;
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function assigneeDisplay(t: TreeTask): { id: number; label: string }[] {
  if (t.assignees && t.assignees.length > 0) {
    return t.assignees.map((a) => ({
      id: a.id,
      label: a.name?.trim() || a.username?.trim() || `User ${a.id}`,
    }));
  }
  return (t.assignee_ids || []).map((id) => ({ id, label: `User ${id}` }));
}

function formatDue(due?: string | null): string | null {
  if (!due) return null;
  const d = new Date(`${due}T00:00:00`);
  if (Number.isNaN(d.getTime())) return due;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function priorityMeta(priority?: string): { icon: string; cls: string; label: string } {
  switch ((priority || "normal").toLowerCase()) {
    case "urgent":
      return { icon: "⇑", cls: "text-rose-500", label: "Urgent Priority" };
    case "high":
      return { icon: "↑", cls: "text-amber-500", label: "High Priority" };
    case "low":
      return { icon: "↓", cls: "text-tertiary", label: "Low Priority" };
    case "normal":
    default:
      return { icon: "═", cls: "text-primary", label: "Normal Priority" };
  }
}

export default function List() {
  const auth = useAuth();
  const { id } = useParams();
  const [timelineTasks, setTimelineTasks] = useState<TreeTask[]>([]);
  const [statuses, setStatuses] = useState<StatusInfo[]>([]);
  const [treeDefault, setTreeDefault] = useState<"tasks-only" | "tasks-subtasks" | "all">("all");
  const [collapsedIds, setCollapsedIds] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [modal, setModal] = useState<{ parentId: number | null; parentTitle?: string | null; kind: "Task" | "Subtask" | "Microtask"; anchorId?: number | null; edge?: "above" | "below" | null } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; taskId: number } | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<number | null>(null);
  const [highlightId, setHighlightId] = useState<number | null>(null);
  const [reorderModal, setReorderModal] = useState<{
    draggedTask: TreeTask;
    targetTask: TreeTask;
    oldPos: number;
    newPos: number;
    wbs: string;
  } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [drawerTaskId, setDrawerTaskId] = useState<number | null>(null);
  const [editTaskId, setEditTaskId] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkPanel, setBulkPanel] = useState<"status" | "due" | null>(null);
  const [bulkStatusId, setBulkStatusId] = useState<number | null>(null);
  const [bulkDue, setBulkDue] = useState("");
  const [bulkWorking, setBulkWorking] = useState(false);
  const [bulkNotice, setBulkNotice] = useState("");
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);
  const [statusMenu, setStatusMenu] = useState<{ x: number; y: number; taskId: number; pendingStatusId: number } | null>(null);
  const [statusSaving, setStatusSaving] = useState(false);
  const canCreate = auth.role !== "guest";
  const canReorder = auth.role !== "guest";

  useEffect(() => {
    if (!auth.accessToken || !id) return;
    fetch(`/api/v1/projects/${id}`, { headers: { Authorization: `Bearer ${auth.accessToken}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((proj) => {
        if (proj?.status_profile_id) {
          return fetch(`/api/v1/status-profiles/${proj.status_profile_id}`, {
            headers: { Authorization: `Bearer ${auth.accessToken}` },
          })
            .then((r) => (r.ok ? r.json() : null))
            .then((sp) => setStatuses(sp?.statuses ?? []));
        }
      })
      .catch(() => undefined);
  }, [auth.accessToken, id]);

  const fetchTimelineData = useCallback(() => {
    if (!auth.accessToken || !id) return;
    setLoading(true);
    setError("");
    const headers = { Authorization: `Bearer ${auth.accessToken}` };
    Promise.all([
      fetch(`/api/v1/tasks/timeline?project_id=${id}`, { headers }).then((r) => {
        if (!r.ok) throw new Error(`Tree failed: ${r.status}`);
        return r.json();
      }),
      fetch(`/api/v1/projects/${id}/tree-default`, { headers }).then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([rows, treeDef]) => {
        setTimelineTasks(rows);
        if (treeDef?.tree_default) {
          setTreeDefault(treeDef.tree_default);
        }
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message || "Failed to load tree");
        setLoading(false);
      });
  }, [auth.accessToken, id]);

  useEffect(() => {
    fetchTimelineData();
  }, [fetchTimelineData, refreshKey]);

  const handleTreeDefaultChange = async (newDefault: "tasks-only" | "tasks-subtasks" | "all") => {
    setTreeDefault(newDefault);
    if (!auth.accessToken || !id) return;
    try {
      await fetch(`/api/v1/projects/${id}/tree-default`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth.accessToken}`,
        },
        body: JSON.stringify({ tree_default: newDefault }),
      });
    } catch {
      // ignore
    }
  };

  const childrenMap = useMemo(() => buildChildrenMap(timelineTasks), [timelineTasks]);

  const statusSignals = useMemo(() => buildStatusSignalMap(statuses), [statuses]);

  const collapseAll = () => {
    const parentIds = new Set<number>();
    for (const [pid, kids] of childrenMap.entries()) {
      if (pid !== null && kids.length > 0) {
        parentIds.add(pid);
      }
    }
    for (const t of timelineTasks) {
      if ((childrenMap.get(t.task_id) || []).length > 0) {
        parentIds.add(t.task_id);
      }
    }
    setCollapsedIds(parentIds);
  };

  const expandAll = () => {
    setCollapsedIds(new Set());
  };

  const taskById = useMemo(() => {
    const m = new Map<number, TreeTask>();
    for (const t of timelineTasks) m.set(t.task_id, t);
    return m;
  }, [timelineTasks]);

  const contextTask = contextMenu != null ? taskById.get(contextMenu.taskId) ?? null : null;
  const deleteTarget = deleteTargetId != null ? taskById.get(deleteTargetId) ?? null : null;

  const expandAncestorsOf = (targetParentId: number | null) => {
    if (targetParentId == null) return;
    const chain: number[] = [];
    let cur: number | null | undefined = targetParentId;
    while (cur != null) {
      chain.push(cur);
      cur = taskById.get(cur)?.parent_id ?? null;
      if (chain.length > 10) break;
    }
    if (chain.length === 0) return;
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      for (const id of chain) next.delete(id);
      return next;
    });
  };

  // Deep-link from global search (?highlight=<taskId>): expand ancestors + flash row
  useEffect(() => {
    const hid = Number(new URLSearchParams(window.location.search).get("highlight"));
    if (!Number.isFinite(hid) || hid <= 0) return;
    setHighlightId(hid);
    const target = taskById.get(hid);
    if (target) expandAncestorsOf(target.parent_id ?? null);
    const t = window.setTimeout(() => setHighlightId((h) => (h === hid ? null : h)), 4000);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, timelineTasks]);

  const openAboveBelow = (anchor: TreeTask, edge: "above" | "below") => {    if (anchor.depth === 0) {
      setModal({ parentId: null, parentTitle: null, kind: "Task", anchorId: anchor.task_id, edge });
    } else if (anchor.depth === 1) {
      const p = taskById.get(anchor.parent_id ?? -1);
      setModal({ parentId: anchor.parent_id ?? null, parentTitle: p?.title ?? null, kind: "Subtask", anchorId: anchor.task_id, edge });
    } else {
      const p = taskById.get(anchor.parent_id ?? -1);
      setModal({ parentId: anchor.parent_id ?? null, parentTitle: p?.title ?? null, kind: "Microtask", anchorId: anchor.task_id, edge });
    }
  };

  const openChild = (parent: TreeTask) => {
    if (parent.depth === 0) {
      setModal({ parentId: parent.task_id, parentTitle: parent.title, kind: "Subtask", anchorId: null, edge: null });
    } else if (parent.depth === 1) {
      setModal({ parentId: parent.task_id, parentTitle: parent.title, kind: "Microtask", anchorId: null, edge: null });
    }
  };

  const handleCreatedInTree = async (newId?: number) => {
    const anchorId = modal?.anchorId ?? null;
    const edge = modal?.edge ?? null;
    const parentId = modal?.parentId ?? null;
    const anchor = anchorId != null ? taskById.get(anchorId) ?? null : null;
    setModal(null);
    expandAncestorsOf(parentId);
    if (newId != null && anchor != null && edge != null && auth.accessToken) {
      try {
        const anchorPos = getSiblingPosition(anchor, timelineTasks);
        const toPos = edge === "above" ? anchorPos : anchorPos + 1;
        await fetch("/api/v1/tasks/reorder", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${auth.accessToken}`,
          },
          body: JSON.stringify({ item_id: newId, to_position: toPos }),
        });
      } catch {
        // Leave appended; fetch below still shows it.
      }
    }
    if (newId != null) {
      setHighlightId(newId);
      window.setTimeout(() => setHighlightId((h) => (h === newId ? null : h)), 2500);
    }
    setRefreshKey((k) => k + 1);
    fetchTimelineData();
  };

  const handleDeleteConfirm = async () => {
    if (deleteTargetId == null || !auth.accessToken) return;
    try {
      const r = await fetch(`/api/v1/tasks/${deleteTargetId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${auth.accessToken}` },
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.detail || `Delete failed: ${r.status}`);
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeleteTargetId(null);
      setContextMenu(null);
      setStatusMenu(null);
      setRefreshKey((k) => k + 1);
      fetchTimelineData();
    }
  };

  const isDoneStatus = (statusId: number) => statuses.find((s) => s.id === statusId)?.is_done === true;

  const toggleSelect = (taskId: number) => {
    setBulkNotice("");
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
    setBulkPanel(null);
    setBulkNotice("");
    setBulkDeleteConfirm(false);
  };

  /** Topmost-selected ids: selected ids with no selected ancestor (delete fires once each). */
  const topmostSelectedIds = (): number[] => {
    const out: number[] = [];
    for (const tid of selectedIds) {
      let cur = taskById.get(tid)?.parent_id ?? null;
      let covered = false;
      let guard = 0;
      while (cur != null && guard++ < 20) {
        if (selectedIds.has(cur)) {
          covered = true;
          break;
        }
        cur = taskById.get(cur)?.parent_id ?? null;
      }
      if (!covered) out.push(tid);
    }
    return out;
  };

  /** Descendants deleted via cascade (selected parent, unselected child). */
  const cascadeSelectedCount = (topmost: number[]): number => {
    let n = 0;
    for (const tid of topmost) {
      for (const d of getSubtreeTasks(tid, childrenMap)) {
        if (!selectedIds.has(d.task_id)) n++;
      }
    }
    return n;
  };

  const selectedTitles = (ids: number[]): Map<number, string> => {
    const m = new Map<number, string>();
    for (const tid of ids) m.set(tid, taskById.get(tid)?.title ?? `#${tid}`);
    return m;
  };

  const handleBulkStatus = async () => {
    if (!auth.accessToken || bulkStatusId == null || selectedIds.size === 0) return;
    const ids = [...selectedIds];
    const titles = selectedTitles(ids);
    setBulkWorking(true);
    setBulkNotice("");
    const failed: number[] = [];
    const failMsgs: string[] = [];
    for (const tid of ids) {
      try {
        const r = await fetch(`/api/v1/tasks/${tid}/status`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${auth.accessToken}`,
          },
          body: JSON.stringify({ status_id: bulkStatusId }),
        });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || `HTTP ${r.status}`);
      } catch (e) {
        failed.push(tid);
        failMsgs.push(`${titles.get(tid)}: ${e instanceof Error ? e.message : "failed"}`);
      }
    }
    const ok = ids.length - failed.length;
    setBulkWorking(false);
    setBulkPanel(null);
    if (failed.length === 0) {
      clearSelection();
      setBulkNotice(`Status updated on ${ok} item${ok === 1 ? "" : "s"}.`);
    } else {
      setSelectedIds(new Set(failed));
      setBulkNotice(
        `Status: ${ok} ok, ${failed.length} failed — ${failMsgs.slice(0, 3).join("; ")}${
          failMsgs.length > 3 ? ` (+${failMsgs.length - 3} more)` : ""
        }. Failed stay selected.`
      );
    }
    setRefreshKey((k) => k + 1);
    fetchTimelineData();
  };

  const handleBulkDueDate = async (clear: boolean) => {
    if (!auth.accessToken || selectedIds.size === 0) return;
    if (!clear && !bulkDue) return;
    const ids = [...selectedIds];
    const titles = selectedTitles(ids);
    setBulkWorking(true);
    setBulkNotice("");
    const failed: number[] = [];
    const failMsgs: string[] = [];
    for (const tid of ids) {
      try {
        const r = await fetch(`/api/v1/tasks/${tid}`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${auth.accessToken}`,
          },
          body: JSON.stringify({ due_date: clear ? "" : bulkDue }),
        });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || `HTTP ${r.status}`);
      } catch (e) {
        failed.push(tid);
        failMsgs.push(`${titles.get(tid)}: ${e instanceof Error ? e.message : "failed"}`);
      }
    }
    const ok = ids.length - failed.length;
    setBulkWorking(false);
    setBulkPanel(null);
    if (failed.length === 0) {
      clearSelection();
      setBulkNotice(`Due date ${clear ? "cleared" : "set"} on ${ok} item${ok === 1 ? "" : "s"}.`);
    } else {
      setSelectedIds(new Set(failed));
      setBulkNotice(
        `Due date: ${ok} ok, ${failed.length} failed — ${failMsgs.slice(0, 3).join("; ")}${
          failMsgs.length > 3 ? ` (+${failMsgs.length - 3} more)` : ""
        }. Failed stay selected.`
      );
    }
    setRefreshKey((k) => k + 1);
    fetchTimelineData();
  };

  const handleBulkDelete = async () => {
    if (!auth.accessToken || selectedIds.size === 0) return;
    const ids = topmostSelectedIds();
    const titles = selectedTitles([...selectedIds]);
    setBulkWorking(true);
    setBulkNotice("");
    const failed: number[] = [];
    const failMsgs: string[] = [];
    let deleted = 0;
    for (const tid of ids) {
      try {
        const r = await fetch(`/api/v1/tasks/${tid}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${auth.accessToken}` },
        });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || `HTTP ${r.status}`);
        deleted++;
      } catch (e) {
        // Mark the failed topmost id plus any selected descendants under it as still-selected.
        failed.push(tid);
        for (const d of getSubtreeTasks(tid, childrenMap)) {
          if (selectedIds.has(d.task_id)) failed.push(d.task_id);
        }
        failMsgs.push(`${titles.get(tid)}: ${e instanceof Error ? e.message : "failed"}`);
      }
    }
    setBulkWorking(false);
    setBulkDeleteConfirm(false);
    setBulkPanel(null);
    if (failed.length === 0) {
      clearSelection();
      setBulkNotice(`Deleted ${deleted} item${deleted === 1 ? "" : "s"} (plus cascade children).`);
    } else {
      setSelectedIds(new Set(failed));
      setBulkNotice(
        `Delete: ${deleted} ok, ${failed.length} failed — ${failMsgs.slice(0, 3).join("; ")}${
          failMsgs.length > 3 ? ` (+${failMsgs.length - 3} more)` : ""
        }. Failed stay selected.`
      );
    }
    setRefreshKey((k) => k + 1);
    fetchTimelineData();
  };

  const handleStatusMenuSave = async () => {
    if (!statusMenu || !auth.accessToken) return;
    const task = taskById.get(statusMenu.taskId);
    if (!task || statusMenu.pendingStatusId === task.status_id) {
      setStatusMenu(null);
      return;
    }
    setStatusSaving(true);
    try {
      const r = await fetch(`/api/v1/tasks/${task.task_id}/status`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth.accessToken}`,
        },
        body: JSON.stringify({ status_id: statusMenu.pendingStatusId }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.detail || `Status change failed: ${r.status}`);
      }
      setStatusMenu(null);
      setRefreshKey((k) => k + 1);
      fetchTimelineData();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Status change failed");
    } finally {
      setStatusSaving(false);
    }
  };

  const visibleTreeTasks = useMemo(() => {
    return getVisibleTreeTasks(timelineTasks, treeDefault, collapsedIds);
  }, [timelineTasks, treeDefault, collapsedIds]);

  const copyTitle = (title: string) => {
    try {
      void navigator.clipboard?.writeText(title);
    } catch {
      // clipboard unavailable; ignore
    }
  };

  return (
    <main className="p-6 bg-surface min-h-screen text-on-surface">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-3">
        <h1 className="text-xl font-semibold">List</h1>
        <div className="flex items-center gap-2 text-xs flex-wrap">
          {canCreate && (
            <button
              onClick={() => setModal({ parentId: null, kind: "Task", anchorId: null, edge: null })}
              className="px-3.5 py-1.5 bg-primary-container hover:bg-primary rounded-lg font-medium text-on-primary"
            >
              + Add Task
            </button>
          )}
        </div>
      </div>

      {/* Tree depth filter bar (ClickUp-style, tree-only — no grouping, no flat view) */}
      <div className="bg-surface-container-lowest border border-subtle rounded-xl p-3 mb-3 flex items-center justify-between gap-3 text-xs flex-wrap shadow-sm">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5 bg-surface-container rounded-lg p-1 border border-subtle">
            <span className="px-2 text-on-surface-variant">Tree view:</span>
            {(["tasks-only", "tasks-subtasks", "all"] as const).map((d) => (
              <button
                key={d}
                onClick={() => handleTreeDefaultChange(d)}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                  treeDefault === d ? "bg-primary-container text-on-primary" : "text-on-surface-variant hover:text-on-surface"
                }`}
              >
                {d === "tasks-only" ? "Tasks only" : d === "tasks-subtasks" ? "Tasks + Subtasks" : "All"}
              </button>
            ))}
          </div>
          <button
            onClick={collapseAll}
            className="px-2.5 py-1.5 bg-surface-container hover:bg-surface-container-high text-on-surface rounded-md border border-subtle font-medium transition-colors text-xs"
          >
            Collapse All
          </button>
          <button
            onClick={expandAll}
            className="px-2.5 py-1.5 bg-surface-container hover:bg-surface-container-high text-on-surface rounded-md border border-subtle font-medium transition-colors text-xs"
          >
            Expand All
          </button>
        </div>
        <div className="text-on-surface-variant font-mono text-xs">
          Total items: {timelineTasks.length} (visible: {visibleTreeTasks.length})
        </div>
      </div>

      {loading && <div role="status" className="mt-3 text-xs text-on-surface-variant">Loading tasks…</div>}
      {error && <div role="alert" className="mt-3 text-xs text-error">{error}</div>}

      {/* Bulk action bar (selection only — checkboxes never mark done) */}
      {selectedIds.size > 0 && (
        <div className="sticky top-2 z-20 mt-3 bg-surface-container-lowest border border-primary rounded-xl shadow-md p-3 text-xs">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-on-surface px-2 py-1 rounded bg-primary-fixed/50 text-primary font-mono">
              {selectedIds.size} selected
            </span>
            <button
              onClick={() => { setBulkPanel(bulkPanel === "status" ? null : "status"); setBulkNotice(""); }}
              disabled={bulkWorking || !canCreate}
              className={`px-3 py-1.5 rounded-lg border font-medium transition-colors ${
                bulkPanel === "status"
                  ? "bg-primary-container text-on-primary border-primary-container"
                  : "bg-surface-container hover:bg-surface-container-high text-on-surface border-subtle"
              } disabled:opacity-50`}
            >
              Status
            </button>
            <button
              onClick={() => { setBulkPanel(bulkPanel === "due" ? null : "due"); setBulkNotice(""); }}
              disabled={bulkWorking || !canCreate}
              className={`px-3 py-1.5 rounded-lg border font-medium transition-colors ${
                bulkPanel === "due"
                  ? "bg-primary-container text-on-primary border-primary-container"
                  : "bg-surface-container hover:bg-surface-container-high text-on-surface border-subtle"
              } disabled:opacity-50`}
            >
              Due date
            </button>
            <button
              onClick={() => { setBulkPanel(null); setBulkDeleteConfirm(true); }}
              disabled={bulkWorking || !canCreate}
              className="px-3 py-1.5 rounded-lg border border-rose-300 bg-rose-50 hover:bg-rose-100 text-error font-medium transition-colors disabled:opacity-50"
            >
              Delete
            </button>
            <button
              onClick={clearSelection}
              disabled={bulkWorking}
              className="px-3 py-1.5 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container font-medium transition-colors disabled:opacity-50 ml-auto"
            >
              Clear
            </button>
          </div>

          {bulkPanel === "status" && (
            <div className="mt-2 pt-2 border-t border-subtle flex items-center gap-2 flex-wrap">
              <span className="text-on-surface-variant">Set status for {selectedIds.size} item{selectedIds.size === 1 ? "" : "s"}:</span>
              <select
                aria-label="bulk status"
                value={bulkStatusId ?? ""}
                onChange={(e) => setBulkStatusId(e.target.value ? Number(e.target.value) : null)}
                className="px-2.5 py-1.5 rounded-lg bg-surface-container border border-subtle text-on-surface min-w-40"
              >
                <option value="">Select status…</option>
                {statuses.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}{s.is_done ? " (done)" : ""}
                  </option>
                ))}
              </select>
              <button
                onClick={() => void handleBulkStatus()}
                disabled={bulkWorking || bulkStatusId == null}
                className="px-3 py-1.5 rounded-lg bg-primary-container hover:bg-primary text-on-primary font-medium disabled:opacity-50"
              >
                {bulkWorking ? "Saving…" : "Save"}
              </button>
              <button
                onClick={() => setBulkPanel(null)}
                disabled={bulkWorking}
                className="px-3 py-1.5 rounded-lg text-on-surface-variant hover:text-on-surface disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          )}

          {bulkPanel === "due" && (
            <div className="mt-2 pt-2 border-t border-subtle flex items-center gap-2 flex-wrap">
              <span className="text-on-surface-variant">Set due date for {selectedIds.size} item{selectedIds.size === 1 ? "" : "s"}:</span>
              <input
                type="date"
                aria-label="bulk due date"
                value={bulkDue}
                onChange={(e) => setBulkDue(e.target.value)}
                className="px-2.5 py-1.5 rounded-lg bg-surface-container border border-subtle text-on-surface"
              />
              <button
                onClick={() => void handleBulkDueDate(false)}
                disabled={bulkWorking || !bulkDue}
                className="px-3 py-1.5 rounded-lg bg-primary-container hover:bg-primary text-on-primary font-medium disabled:opacity-50"
              >
                {bulkWorking ? "Saving…" : "Apply"}
              </button>
              <button
                onClick={() => void handleBulkDueDate(true)}
                disabled={bulkWorking}
                className="px-3 py-1.5 rounded-lg border border-subtle text-on-surface-variant hover:text-on-surface disabled:opacity-50"
                title="Remove due dates from all selected"
              >
                Clear dates
              </button>
              <button
                onClick={() => setBulkPanel(null)}
                disabled={bulkWorking}
                className="px-3 py-1.5 rounded-lg text-on-surface-variant hover:text-on-surface disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          )}

          {bulkNotice && (
            <div role="status" className="mt-2 pt-2 border-t border-subtle text-on-surface-variant">
              {bulkNotice}
            </div>
          )}
        </div>
      )}

      {/* ClickUp-style hierarchical tree grid (Task Name / Status / Assignee / Due Date / Priority — no WBS column) */}
      <div className="mt-4 bg-surface-container-lowest border border-subtle rounded-xl overflow-visible shadow-sm">
        <div className="grid grid-cols-12 bg-surface-container-low px-4 py-2.5 text-xs font-semibold text-on-surface-variant rounded-t-xl select-none">
          <div className="col-span-12 sm:col-span-6 uppercase tracking-wider">Task Name</div>
          <div className="col-span-3 sm:col-span-2 hidden sm:block uppercase tracking-wider">Status</div>
          <div className="col-span-2 sm:col-span-2 hidden sm:block uppercase tracking-wider">Assignee</div>
          <div className="col-span-2 sm:col-span-1 hidden sm:block uppercase tracking-wider">Due Date</div>
          <div className="col-span-1 sm:col-span-1 hidden sm:flex uppercase tracking-wider justify-end">Priority</div>
        </div>
        <div className="flex flex-col relative divide-y divide-border-subtle">
          {visibleTreeTasks.map((t) => {
            const kids = childrenMap.get(t.task_id) || [];
            const hasKids = kids.length > 0;
            const isCollapsed = collapsedIds.has(t.task_id);
            const stats = hasKids && isCollapsed ? getDescendantStats(t.task_id, childrenMap, statuses) : null;
            const st = statuses.find((s) => s.id === t.status_id);
            const done = Boolean(st?.is_done);
            const people = assigneeDisplay(t);
            const primary = people[0];
            const due = formatDue(t.due_date);
            const pri = priorityMeta(t.priority);
            const isParent = t.depth === 0;
            // Sibling position for elbow connector (last child gets half-height guide).
            const siblings = childrenMap.get(t.parent_id ?? null) || [];
            const isLast = siblings.length > 0 && siblings[siblings.length - 1]?.task_id === t.task_id;
            const indentClass = t.depth === 1 ? "pl-9" : t.depth === 2 ? "pl-16" : "pl-0";
            const guideLeft = t.depth === 1 ? "left-7" : "left-14";
            return (
              <div
                key={t.task_id}
                className="group relative hover:bg-surface-container-low/70 transition-colors"
                draggable={canReorder}
                title={getReorderDisabledReason(auth.role, false) ?? "Right-click for Add Above / Below / Child / Delete"}
                onContextMenu={(e) => {
                  if (!canCreate) return;
                  e.preventDefault();
                  setStatusMenu(null);
                  setContextMenu({ x: e.clientX, y: e.clientY, taskId: t.task_id });
                }}
                onDragStart={(e) => {
                  if (!canReorder) return;
                  e.dataTransfer.setData("text/plain", String(t.task_id));
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = canReorder ? "move" : "none";
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (!canReorder) return;
                  const draggedId = Number(e.dataTransfer.getData("text/plain"));
                  if (!draggedId || draggedId === t.task_id) return;
                  const draggedTask = timelineTasks.find((x) => x.task_id === draggedId);
                  if (!draggedTask) return;
                  if (!canDropAsSiblings(draggedTask, t)) {
                    alert("Cross-parent reorder not allowed");
                    return;
                  }
                  const oldPos = getSiblingPosition(draggedTask, timelineTasks);
                  const newPos = getSiblingPosition(t, timelineTasks);
                  const wbs = draggedTask.wbs || getWbsNumber(timelineTasks.indexOf(draggedTask), timelineTasks);
                  setReorderModal({
                    draggedTask,
                    targetTask: t,
                    oldPos,
                    newPos,
                    wbs,
                  });
                }}
              >
                <div className={`grid grid-cols-12 items-center px-4 ${isParent ? "py-2.5" : "py-2"} ${highlightId === t.task_id ? "bg-primary-fixed/40 outline outline-1 outline-primary" : ""}`}>
                  {/* Task Name + tree toggle + connectors */}
                  <div className={`col-span-12 sm:col-span-6 flex items-center gap-2 min-w-0 pr-2 relative ${indentClass}`}>
                    {t.depth > 0 && (
                      <>
                        <div className={`absolute ${guideLeft} top-0 ${isLast ? "h-1/2" : "bottom-0"} w-px bg-outline-variant/60`} />
                        <div className={`absolute ${guideLeft} top-1/2 w-4 h-3.5 border-b-2 border-l-2 border-outline-variant/60 rounded-bl -mt-3.5`} />
                      </>
                    )}
                    <button
                      className="opacity-0 group-hover:opacity-100 text-outline hover:text-on-surface cursor-grab transition-opacity shrink-0"
                      title="Drag to reorder"
                      tabIndex={-1}
                    >
                      ⋮⋮
                    </button>
                    {hasKids ? (
                      <button
                        onClick={() => {
                          setCollapsedIds((prev) => {
                            const next = new Set(prev);
                            if (next.has(t.task_id)) next.delete(t.task_id);
                            else next.add(t.task_id);
                            return next;
                          });
                        }}
                        className="w-5 h-5 flex items-center justify-center rounded hover:bg-surface-container text-on-surface-variant shrink-0 text-sm"
                        aria-label={isCollapsed ? "Expand" : "Collapse"}
                      >
                        {isCollapsed ? "▸" : "▾"}
                      </button>
                    ) : (
                      <span className="w-5 shrink-0 text-center text-outline text-xs">{isParent ? "▸" : ""}</span>
                    )}
                    <input
                      type="checkbox"
                      checked={selectedIds.has(t.task_id)}
                      disabled={!canCreate}
                      onChange={() => toggleSelect(t.task_id)}
                      onClick={(e) => e.stopPropagation()}
                      className="w-4 h-4 rounded accent-primary cursor-pointer shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
                      title="Select for bulk actions"
                      aria-label={`Select ${t.title}`}
                    />
                    <div className="flex items-center gap-1.5 min-w-0">
                      <button
                        onClick={() => setEditTaskId(t.task_id)}
                        className={`truncate hover:text-primary hover:underline text-left ${isParent ? "font-semibold text-[13px]" : "text-xs"} ${done ? "line-through text-on-surface-variant" : "text-on-surface"}`}
                        title="Edit (status, dates, assignee, comments)"
                      >
                        {t.is_blocked && <span className="mr-1 px-1 rounded bg-error-container text-error font-bold" title="Blocked" role="img" aria-label="Blocked">!</span>}
                        {t.title}
                      </button>
                      <button
                        onClick={() => copyTitle(t.title)}
                        className="text-outline hover:text-primary transition-colors shrink-0 text-xs"
                        title="Copy task title"
                      >
                        ⎘
                      </button>
                    </div>
                    {hasKids && (
                      <span className="px-1.5 py-0.5 rounded-full bg-surface-container-high text-on-surface-variant font-mono text-[10px] ml-1 shrink-0">
                        {kids.length} {t.depth === 0 ? (kids.length === 1 ? "subtask" : "subtasks") : kids.length === 1 ? "micro-task" : "micro-tasks"}
                      </span>
                    )}
                    {stats && (
                      <span className="ml-1 font-mono text-[10px] text-primary bg-primary-fixed/60 px-1.5 py-0.5 rounded border border-primary shrink-0">
                        +{stats.total} children, {stats.completed} Complete
                      </span>
                    )}
                    {canCreate && t.depth < 2 && (
                      <button
                        onClick={() =>
                          setModal({
                            parentId: t.task_id,
                            parentTitle: t.title,
                            kind: t.depth === 0 ? "Subtask" : "Microtask",
                            anchorId: null,
                            edge: null,
                          })
                        }
                        className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 text-primary hover:underline text-[11px] ml-auto shrink-0 transition-opacity"
                      >
                        + {t.depth === 0 ? "Subtask" : "Microtask"}
                      </button>
                    )}
                    {canCreate && (
                      <button
                        onClick={() => setDeleteTargetId(t.task_id)}
                        className="text-error/70 hover:text-error hover:bg-rose-50 rounded px-1.5 py-0.5 text-xs shrink-0"
                        title={`Delete ${t.depth === 0 ? "Task" : t.depth === 1 ? "Subtask" : "Microtask"} (works even if incomplete)`}
                      >
                        🗑
                      </button>
                    )}
                  </div>
                  {/* Status pill (neutral + colored dot hashed by status_id; right-click for Change Status) */}
                  <div className="col-span-6 sm:col-span-2 mt-1 sm:mt-0 flex items-center">
                    <button
                      onClick={() => setEditTaskId(t.task_id)}
                      onContextMenu={(e) => {
                        if (!canCreate) return;
                        e.preventDefault();
                        e.stopPropagation();
                        setContextMenu(null);
                        setStatusMenu({ x: e.clientX, y: e.clientY, taskId: t.task_id, pendingStatusId: t.status_id });
                      }}
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface-container border border-subtle hover:bg-surface-container-high transition-colors text-[11px] font-medium text-on-surface max-w-full"
                      title={`Status: ${t.status_name || "Status"} — click to edit, right-click to change status`}
                    >
                      <span className={`w-2 h-2 rounded-full shrink-0 ${statusDot(t.status_id)}`} />
                      <span className="truncate">{t.status_name || "Status"}</span>
                      {(() => {
                        const sig = statusSignals.get(t.status_id);
                        if (!sig) return null;
                        return (
                          <span
                            role="img"
                            aria-label={`Status signal: ${sig.glyph} ${sig.weight}% ${sig.label}`}
                            title={`${sig.weight}% within stage · ${sig.label}${sig.milestone ? " · milestone" : ""}`}
                            className="font-mono text-[10px] text-on-surface-variant shrink-0"
                          >
                            {sig.glyph} {sig.weight}%{sig.milestone ? " ★" : ""}
                          </span>
                        );
                      })()}
                    </button>
                  </div>
                  {/* Assignee */}
                  <div className="col-span-3 sm:col-span-2 hidden sm:flex items-center gap-1.5 min-w-0">
                    {primary ? (
                      <>
                        <div className={`w-6 h-6 rounded-full ${avatarBg(primary.id)} font-mono text-[10px] flex items-center justify-center font-bold shrink-0`}>
                          {initials(primary.label, primary.id)}
                        </div>
                        <span className="text-xs text-on-surface truncate">{primary.label}</span>
                        {people.length > 1 && (
                          <span className="text-[10px] text-on-surface-variant shrink-0">+{people.length - 1}</span>
                        )}
                      </>
                    ) : (
                      <span className="text-outline italic text-xs">Unassigned</span>
                    )}
                  </div>
                  {/* Due date */}
                  <div className="col-span-2 sm:col-span-1 hidden sm:flex items-center text-xs">
                    {due ? (
                      <span className="text-on-surface">{due}</span>
                    ) : (
                      <span className="italic text-outline">No due date</span>
                    )}
                  </div>
                  {/* Priority */}
                  <div className="col-span-1 sm:col-span-1 hidden sm:flex items-center justify-end">
                    <span className={`text-base font-bold ${pri.cls}`} title={pri.label}>
                      {pri.icon}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => setDrawerTaskId(t.task_id)}
                  className="absolute right-1 top-1 text-[10px] text-outline hover:text-on-surface opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Open advanced drawer (tags, blocked-by, attachments, custom fields)"
                >
                  ⧉
                </button>
              </div>
            );
          })}
          {visibleTreeTasks.length === 0 && !loading && (
            <div className="py-12 text-center text-outline text-sm">No tasks found for the current tree view filter.</div>
          )}
          {canCreate && (
            <button
              onClick={() => setModal({ parentId: null, kind: "Task", anchorId: null, edge: null })}
              className="flex items-center gap-2 px-4 py-2.5 text-on-surface-variant hover:text-primary hover:bg-surface-container-low/40 cursor-pointer transition-colors rounded-b-xl text-[13px] font-medium w-full text-left"
            >
              <span className="text-primary text-base">+</span>
              <span>New task...</span>
            </button>
          )}
        </div>
      </div>

      <div className="mt-4 border-t border-subtle pt-2">{id && <TelemetryBar projectId={id} />}</div>
      {modal && id && (
        <TaskCreateModal
          projectId={id}
          parentId={modal.parentId}
          parentTitle={modal.parentTitle}
          kind={modal.kind}
          onClose={() => setModal(null)}
          onCreated={(newId) => {
            void handleCreatedInTree(newId);
          }}
        />
      )}
      {contextMenu && contextTask && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setContextMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setContextMenu(null);
            }}
          />
          <div
            role="menu"
            aria-label={`Actions for ${contextTask.title}`}
            className="fixed z-50 w-56 rounded-lg border border-subtle bg-surface-container-lowest shadow-xl py-1 text-xs text-on-surface"
            style={{
              left: Math.min(contextMenu.x, window.innerWidth - 240),
              top: Math.min(contextMenu.y, window.innerHeight - 220),
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") setContextMenu(null);
            }}
          >
            <div className="px-3 py-1.5 font-mono text-[10px] text-on-surface-variant border-b border-subtle truncate">
              {contextTask.wbs || `#${contextTask.task_id}`} · {contextTask.title}
            </div>
            {contextTask.depth === 0 && (
              <>
                <button
                  role="menuitem"
                  onClick={() => { const a = contextTask; setContextMenu(null); openAboveBelow(a, "above"); }}
                  className="w-full text-left px-3 py-2 hover:bg-surface-container"
                >
                  Add Task Above
                </button>
                <button
                  role="menuitem"
                  onClick={() => { const a = contextTask; setContextMenu(null); openAboveBelow(a, "below"); }}
                  className="w-full text-left px-3 py-2 hover:bg-surface-container"
                >
                  Add Task Below
                </button>
                <button
                  role="menuitem"
                  onClick={() => { const p = contextTask; setContextMenu(null); openChild(p); }}
                  className="w-full text-left px-3 py-2 hover:bg-surface-container"
                >
                  Add Subtask
                </button>
              </>
            )}
            {contextTask.depth === 1 && (
              <>
                <button
                  role="menuitem"
                  onClick={() => { const a = contextTask; setContextMenu(null); openAboveBelow(a, "above"); }}
                  className="w-full text-left px-3 py-2 hover:bg-surface-container"
                >
                  Add Subtask Above
                </button>
                <button
                  role="menuitem"
                  onClick={() => { const a = contextTask; setContextMenu(null); openAboveBelow(a, "below"); }}
                  className="w-full text-left px-3 py-2 hover:bg-surface-container"
                >
                  Add Subtask Below
                </button>
                <button
                  role="menuitem"
                  onClick={() => { const p = contextTask; setContextMenu(null); openChild(p); }}
                  className="w-full text-left px-3 py-2 hover:bg-surface-container"
                >
                  Add Microtask
                </button>
              </>
            )}
            {contextTask.depth === 2 && (
              <>
                <button
                  role="menuitem"
                  onClick={() => { const a = contextTask; setContextMenu(null); openAboveBelow(a, "above"); }}
                  className="w-full text-left px-3 py-2 hover:bg-surface-container"
                >
                  Add Microtask Above
                </button>
                <button
                  role="menuitem"
                  onClick={() => { const a = contextTask; setContextMenu(null); openAboveBelow(a, "below"); }}
                  className="w-full text-left px-3 py-2 hover:bg-surface-container"
                >
                  Add Microtask Below
                </button>
              </>
            )}
            <div className="border-t border-subtle mt-1 pt-1">
              <button
                role="menuitem"
                onClick={() => { setDeleteTargetId(contextTask.task_id); }}
                className="w-full text-left px-3 py-2 text-error hover:bg-surface-container"
              >
                {contextTask.depth === 0 ? "Delete Task" : contextTask.depth === 1 ? "Delete Subtask" : "Delete Microtask"}
              </button>
            </div>
          </div>
        </>
      )}
      {statusMenu && (() => {
        const st = taskById.get(statusMenu.taskId);
        if (!st) return null;
        return (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => { if (!statusSaving) setStatusMenu(null); }}
              onContextMenu={(e) => {
                e.preventDefault();
                if (!statusSaving) setStatusMenu(null);
              }}
            />
            <div
              role="menu"
              aria-label={`Change Status for ${st.title}`}
              className="fixed z-50 w-72 rounded-lg border border-subtle bg-surface-container-lowest shadow-xl py-1 text-xs text-on-surface"
              style={{
                left: Math.min(statusMenu.x, window.innerWidth - 300),
                top: Math.min(statusMenu.y, window.innerHeight - 340),
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") setStatusMenu(null);
              }}
            >
              <div className="px-3 py-1.5 font-semibold text-on-surface border-b border-subtle truncate">
                Change Status ›
              </div>
              <div className="px-3 py-1 font-mono text-[10px] text-on-surface-variant truncate border-b border-subtle">
                {st.wbs || `#${st.task_id}`} · {st.title} (now: {st.status_name})
              </div>
              <div className="max-h-56 overflow-y-auto py-1">
                {statuses.length === 0 && (
                  <div className="px-3 py-2 text-on-surface-variant">No statuses in this project's profile.</div>
                )}
                {statuses.map((s) => (
                  <button
                    key={s.id}
                    role="menuitemradio"
                    aria-checked={statusMenu.pendingStatusId === s.id}
                    onClick={() => setStatusMenu((m) => (m ? { ...m, pendingStatusId: s.id } : m))}
                    className={`w-full flex items-center justify-between px-3 py-1.5 hover:bg-surface-container text-left ${
                      statusMenu.pendingStatusId === s.id ? "bg-primary-fixed/30 font-semibold" : ""
                    }`}
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${statusDot(s.id)}`} />
                      <span className="truncate">{s.name}</span>
                      {s.is_done && <span className="text-[10px] text-tertiary">· done</span>}
                    </span>
                    {statusMenu.pendingStatusId === s.id && <span className="text-primary">✓</span>}
                  </button>
                ))}
              </div>
              <div className="flex justify-end gap-2 px-3 py-2 border-t border-subtle">
                <button
                  onClick={() => setStatusMenu(null)}
                  disabled={statusSaving}
                  className="px-3 py-1.5 rounded bg-surface-container hover:bg-surface-container-high text-on-surface-variant font-medium disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={() => void handleStatusMenuSave()}
                  disabled={statusSaving || statusMenu.pendingStatusId === st.status_id}
                  className="px-3 py-1.5 rounded bg-primary-container hover:bg-primary text-on-primary font-medium disabled:opacity-50"
                >
                  {statusSaving ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          </>
        );
      })()}
      {bulkDeleteConfirm && (() => {
        const topmost = topmostSelectedIds();
        const cascade = cascadeSelectedCount(topmost);
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
            <div className="w-full max-w-md rounded-lg border border-subtle bg-surface-container-lowest p-4">
              <h2 className="text-sm font-semibold text-on-surface">
                Delete {selectedIds.size} selected item{selectedIds.size === 1 ? "" : "s"}{cascade > 0 ? ` (+${cascade} cascade child${cascade === 1 ? "" : "ren"})` : ""}?
              </h2>
              <p className="mt-2 text-xs text-on-surface-variant">
                Deletes each selected Task / Subtask / Microtask even if not complete. Children of a selected
                parent are deleted via cascade (fired once per topmost item).
                {" "}This cannot be undone.
              </p>
              <div className="mt-4 flex justify-end gap-2 text-xs">
                <button
                  onClick={() => setBulkDeleteConfirm(false)}
                  disabled={bulkWorking}
                  className="px-3 py-1.5 rounded bg-surface-container hover:bg-surface-container-high text-on-surface-variant font-medium disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={() => void handleBulkDelete()}
                  disabled={bulkWorking}
                  className="px-3 py-1.5 rounded bg-rose-700 hover:bg-rose-600 text-white font-medium disabled:opacity-50"
                >
                  {bulkWorking ? "Deleting…" : "Delete"}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-lg border border-subtle bg-surface-container-lowest p-4">
            <h2 className="text-sm font-semibold text-on-surface">
              Delete {deleteTarget.depth === 0 ? "Task" : deleteTarget.depth === 1 ? "Subtask" : "Microtask"} {deleteTarget.wbs || `#${deleteTarget.task_id}`}?
            </h2>
            {(() => {
              const desc = getSubtreeTasks(deleteTarget.task_id, childrenMap);
              const nSub = desc.filter((d) => d.depth === 1).length;
              const nMicro = desc.filter((d) => d.depth === 2).length;
              const total = desc.length;
              return (
                <p className="mt-2 text-xs text-on-surface-variant">
                  &apos;{deleteTarget.title}&apos;
                  {total === 0
                    ? " has no children. Only this item will be deleted, even if it is not complete."
                    : ` will also delete ${total} item${total === 1 ? "" : "s"}${nSub > 0 ? ` (${nSub} Subtask${nSub === 1 ? "" : "s"})` : ""}${nMicro > 0 ? `${nSub > 0 ? " + " : " ("}${nMicro} Microtask${nMicro === 1 ? "" : "s"}${nSub > 0 ? "" : ")"}` : ""}, even if they are not complete.`}
                  {" "}This cannot be undone.
                </p>
              );
            })()}
            <div className="mt-4 flex justify-end gap-2 text-xs">
              <button
                onClick={() => { setDeleteTargetId(null); setContextMenu(null); }}
                className="px-3 py-1.5 rounded bg-surface-container hover:bg-surface-container-high text-on-surface-variant font-medium"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleDeleteConfirm()}
                className="px-3 py-1.5 rounded bg-rose-700 hover:bg-rose-600 text-white font-medium"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
      {drawerTaskId && id && (
        <TaskDrawer
          taskId={drawerTaskId}
          projectId={id}
          onClose={() => setDrawerTaskId(null)}
          onUpdated={() => {
            setRefreshKey((k) => k + 1);
            fetchTimelineData();
          }}
        />
      )}
      {editTaskId != null && id && (
        <TaskDialog
          projectId={id}
          mode="edit"
          taskId={editTaskId}
          onClose={() => setEditTaskId(null)}
          onUpdated={() => {
            setRefreshKey((k) => k + 1);
            fetchTimelineData();
          }}
        />
      )}
      {reorderModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-lg border border-subtle bg-surface-container-lowest p-4">
            <h2 className="text-sm font-semibold text-on-surface">Confirm Reorder</h2>
            <p className="mt-2 text-xs font-mono text-primary bg-primary-fixed/60 p-2 rounded border border-primary">
              {formatReorderConfirm(
                reorderModal.wbs,
                reorderModal.draggedTask.title,
                reorderModal.oldPos,
                reorderModal.newPos
              )}
            </p>
            <div className="mt-4 flex justify-end gap-2 text-xs">
              <button
                onClick={() => setReorderModal(null)}
                className="px-3 py-1.5 rounded bg-surface-container hover:bg-surface-container-high text-on-surface-variant font-medium"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  if (!auth.accessToken) return;
                  try {
                    const r = await fetch("/api/v1/tasks/reorder", {
                      method: "POST",
                      headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${auth.accessToken}`,
                      },
                      body: JSON.stringify({
                        item_id: reorderModal.draggedTask.task_id,
                        to_position: reorderModal.newPos,
                      }),
                    });
                    if (!r.ok) {
                      const err = await r.json().catch(() => ({}));
                      throw new Error(err.detail || `Reorder failed: ${r.status}`);
                    }
                    setReorderModal(null);
                    fetchTimelineData();
                  } catch (e) {
                    alert(e instanceof Error ? e.message : "Reorder failed");
                    setReorderModal(null);
                  }
                }}
                className="px-3 py-1.5 rounded bg-primary-container hover:bg-primary text-on-primary font-medium"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
