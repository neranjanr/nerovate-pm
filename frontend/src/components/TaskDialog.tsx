import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../stores/auth";

export type TaskLevel = 0 | 1 | 2;
export type TaskDialogMode = "create" | "edit";

interface TaskDialogProps {
  projectId: string | number;
  mode: TaskDialogMode;
  /** Edit mode: task to load. */
  taskId?: number;
  /** Create mode: pre-selected parent (auto-select when launched from a row's "+ child"). */
  initialParentId?: number | null;
  initialLevel?: TaskLevel;
  /** Create mode: pre-selected leaf Status (context-aware Add Task from Kanban). */
  initialStatusId?: number | null;
  /** Compat: "Task" | "Subtask" | "Microtask" label used by old callers. */
  initialKind?: "Task" | "Subtask" | "Microtask";
  parentTitle?: string | null;
  onClose: () => void;
  onCreated?: (taskId: number) => void;
  onUpdated?: () => void;
}

interface ProfileStatus {
  id: number;
  name: string;
  stage_id?: number | null;
  order: number;
}

interface StageInfo {
  id: number;
  name: string;
  order: number;
}

interface MemberInfo {
  user_id: number;
  role: string;
}

interface ParentCandidate {
  id: number;
  title: string;
  depth: number;
  parent_id?: number | null;
  wbs?: string;
}

interface StatusPeriod {
  id: number;
  task_id: number;
  status_id: number;
  start_date?: string | null;
  due_date?: string | null;
  actual_end_date?: string | null;
}

interface TaskOut {
  id: number;
  project_id: number;
  parent_id?: number | null;
  depth: number;
  title: string;
  description_md: string;
  status_id: number;
  priority: string;
  start_date: string;
  due_date?: string | null;
  assignee_ids: number[];
  watcher_ids: number[];
  status_periods: StatusPeriod[];
}

interface CommentOut {
  id: number;
  task_id: number;
  parent_id?: number | null;
  author_id: number;
  body_md: string;
  created_at: string;
}

const LEVEL_LABEL: Record<TaskLevel, string> = { 0: "Task", 1: "Subtask", 2: "Microtask" };
const PRIORITIES = ["urgent", "high", "normal", "low"] as const;

function kindToLevel(kind?: "Task" | "Subtask" | "Microtask"): TaskLevel {
  if (kind === "Subtask") return 1;
  if (kind === "Microtask") return 2;
  return 0;
}

function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}` };
}

/**
 * Unified create/edit dialog for Task (0) / Subtask (1) / Microtask (2).
 * Layout follows sampleaddtask.html: breadcrumb + level switcher + parent
 * picker header, two-column body (title/desc/comments | status/priority/
 * assignee/dates/period), footer with Cancel/Save.
 *
 * Agreed rules (grill Q1-17):
 * - Project locked from launch context; parent same-Project only, required
 *   for depth 1/2, forbidden for depth 0; auto-select when initialParentId set.
 * - Status options = leaf Statuses of the Category Profile (via Project),
 *   grouped by Stage; defaults to first leaf; required.
 * - Dates = Task start/due + current-period start/due/actual_end (all optional
 *   inputs, Task start defaults to today); past periods read-only collapsed.
 * - Comments: optional initial box on create; newest-first list + add +
 *   edit/delete own on edit with server timestamps.
 * - Level switchable in create, locked in edit.
 */
export default function TaskDialog({
  projectId,
  mode,
  taskId,
  initialParentId = null,
  initialLevel,
  initialStatusId = null,
  initialKind,
  parentTitle = null,
  onClose,
  onCreated,
  onUpdated,
}: TaskDialogProps) {
  const auth = useAuth();
  const isEdit = mode === "edit";

  const [level, setLevel] = useState<TaskLevel>(
    initialLevel ?? kindToLevel(initialKind ?? (initialParentId != null ? "Subtask" : "Task"))
  );
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [statuses, setStatuses] = useState<ProfileStatus[]>([]);
  const [stages, setStages] = useState<StageInfo[]>([]);
  const [statusId, setStatusId] = useState<number | null>(null);
  const [defaultStatusName, setDefaultStatusName] = useState<string | null>(null);
  const [priority, setPriority] = useState<string>("normal");
  const [members, setMembers] = useState<MemberInfo[]>([]);
  const [assigneeId, setAssigneeId] = useState<number | null>(null);
  const [watcherIds, setWatcherIds] = useState<number[]>([]);
  const [taskStart, setTaskStart] = useState("");
  const [taskDue, setTaskDue] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodDue, setPeriodDue] = useState("");
  const [periodActual, setPeriodActual] = useState("");
  const [pastPeriods, setPastPeriods] = useState<StatusPeriod[]>([]);
  const [showPastPeriods, setShowPastPeriods] = useState(false);
  const [parentId, setParentId] = useState<number | null>(initialParentId);
  const [parentSearch, setParentSearch] = useState("");
  const [candidates, setCandidates] = useState<ParentCandidate[]>([]);
  const [projectCode, setProjectCode] = useState("");
  const [projectName, setProjectName] = useState("");
  const [categoryName, setCategoryName] = useState("");
  const [comments, setComments] = useState<CommentOut[]>([]);
  const [initialComment, setInitialComment] = useState("");
  const [newComment, setNewComment] = useState("");
  const [editingCommentId, setEditingCommentId] = useState<number | null>(null);
  const [editingBody, setEditingBody] = useState("");
  const [wbsPreview, setWbsPreview] = useState("");
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  // ---- load project + profile + members + defaults (both modes) ----
  useEffect(() => {
    if (!auth.accessToken || !projectId) return;
    let cancelled = false;
    setLoading(true);
    const headers = authHeaders(auth.accessToken);
    (async () => {
      try {
        const proj: Record<string, unknown> | null = await fetch(`/api/v1/projects/${projectId}`, {
          headers,
        }).then((r) => (r.ok ? r.json() : null));
        if (cancelled) return;
        if (proj) {
          setProjectCode(String(proj.code ?? ""));
          setProjectName(String(proj.name ?? ""));
          setCategoryName(String(proj.category_name ?? ""));
        }
        let profileId: number | null =
          typeof proj?.status_profile_id === "number" ? (proj.status_profile_id as number) : null;
        const categoryId = proj?.category_id as number | undefined;
        if (!profileId && categoryId) {
          const cat: Record<string, unknown> | null = await fetch(`/api/v1/categories/${categoryId}`, {
            headers,
          }).then((r) => (r.ok ? r.json() : null));
          if (cancelled) return;
          profileId = typeof cat?.status_profile_id === "number" ? (cat.status_profile_id as number) : null;
          if (!categoryName && cat?.name) setCategoryName(String(cat.name));
        }
        if (profileId) {
          const sp = await fetch(`/api/v1/status-profiles/${profileId}`, { headers }).then((r) =>
            r.ok ? r.json() : null
          );
          if (cancelled) return;
          if (sp) {
            const sortedStatuses: ProfileStatus[] = (sp.statuses ?? [])
              .slice()
              .sort((a: ProfileStatus, b: ProfileStatus) => a.order - b.order);
            setStatuses(sortedStatuses);
            setStages(
              (sp.stages ?? []).slice().sort((a: StageInfo, b: StageInfo) => a.order - b.order)
            );
            if (statusId == null && sortedStatuses.length > 0 && !isEdit) {
              // Context-aware preset (e.g. Kanban "+ Add Task") wins over first-leaf default.
              if (initialStatusId != null && sortedStatuses.some((s) => s.id === initialStatusId)) {
                setStatusId(initialStatusId);
              } else {
                setStatusId(sortedStatuses[0].id);
              }
            } else if (!isEdit && initialStatusId != null && sortedStatuses.some((s) => s.id === initialStatusId)) {
              setStatusId(initialStatusId);
            }
          }
        }
        const defaults = await fetch(`/api/v1/tasks/defaults?project_id=${projectId}`, { headers }).then(
          (r) => (r.ok ? r.json() : null)
        );
        if (cancelled) return;
        if (defaults) {
          setDefaultStatusName(defaults.status_name ?? null);
          if (!isEdit) {
            if (statusId == null && typeof defaults.status_id === "number") {
              setStatusId(defaults.status_id);
            }
            setTaskStart(defaults.start_date ?? today);
          }
        } else if (!isEdit && !taskStart) {
          setTaskStart(today);
        }
        const mems: MemberInfo[] = await fetch(`/api/v1/projects/${projectId}/members`, { headers }).then(
          (r) => (r.ok ? r.json() : [])
        );
        if (cancelled) return;
        setMembers(Array.isArray(mems) ? mems : []);
      } catch {
        if (!cancelled) setError("Failed to load project profile");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.accessToken, projectId]);

  // ---- edit mode: load task + comments ----
  useEffect(() => {
    if (!isEdit || !auth.accessToken || taskId == null) return;
    let cancelled = false;
    const headers = authHeaders(auth.accessToken);
    (async () => {
      try {
        const t: TaskOut | null = await fetch(`/api/v1/tasks/${taskId}`, { headers }).then((r) =>
          r.ok ? r.json() : null
        );
        if (cancelled || !t) return;
        setLevel(t.depth as TaskLevel);
        setTitle(t.title);
        setDescription(t.description_md || "");
        setStatusId(t.status_id);
        setPriority(t.priority || "normal");
        setAssigneeId(t.assignee_ids?.[0] ?? null);
        setWatcherIds(t.watcher_ids ?? []);
        setTaskStart(t.start_date || "");
        setTaskDue(t.due_date || "");
        setParentId(t.parent_id ?? null);
        const curr = t.status_periods?.find((p) => p.status_id === t.status_id);
        if (curr) {
          setPeriodStart(curr.start_date || t.start_date || "");
          setPeriodDue(curr.due_date || "");
          setPeriodActual(curr.actual_end_date || "");
          setPastPeriods((t.status_periods || []).filter((p) => p.status_id !== t.status_id));
        } else {
          setPeriodStart(t.start_date || "");
          setPeriodDue("");
          setPeriodActual("");
          setPastPeriods(t.status_periods || []);
        }
        const c: CommentOut[] = await fetch(`/api/v1/tasks/${taskId}/comments`, { headers }).then((r) =>
          r.ok ? r.json() : []
        );
        if (cancelled) return;
        setComments(Array.isArray(c) ? c : []);
      } catch {
        if (!cancelled) setError("Failed to load task");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isEdit, taskId, auth.accessToken]);

  // ---- parent candidates for create (same-Project only) ----
  useEffect(() => {
    if (isEdit || !auth.accessToken || !projectId) return;
    if (level === 0) {
      setCandidates([]);
      return;
    }
    const wantDepth = level === 1 ? 0 : 1; // Subtask needs Tasks, Microtask needs Subtasks
    fetch(`/api/v1/tasks?project_id=${projectId}&depth=${wantDepth}`, {
      headers: authHeaders(auth.accessToken),
    })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => {
        const list: ParentCandidate[] = (Array.isArray(rows) ? rows : []).map((t: Record<string, unknown>) => ({
          id: Number(t.id),
          title: String(t.title ?? ""),
          depth: Number(t.depth ?? wantDepth),
          parent_id: (t.parent_id as number | null) ?? null,
          wbs: String(t.wbs ?? ""),
        }));
        setCandidates(list);
        // Keep auto-selected parent if still valid; else clear stale selection.
        if (parentId != null && !list.some((c) => c.id === parentId)) {
          setParentId(null);
        }
      })
      .catch(() => setCandidates([]));
  }, [isEdit, level, auth.accessToken, projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- WBS preview ----
  useEffect(() => {
    if (isEdit && taskId != null) {
      setWbsPreview(`#${taskId}`);
      return;
    }
    if (level === 0) {
      setWbsPreview(projectCode ? `${projectCode} · next Task` : "next Task");
      return;
    }
    const p = candidates.find((c) => c.id === parentId);
    if (p) {
      setWbsPreview(`${p.wbs || `#${p.id}`} · child (${LEVEL_LABEL[level]})`);
    } else {
      setWbsPreview("will be assigned on save");
    }
  }, [isEdit, taskId, level, parentId, candidates, projectCode]);

  const filteredCandidates = useMemo(() => {
    const q = parentSearch.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter(
      (c) => c.title.toLowerCase().includes(q) || String(c.id).includes(q) || (c.wbs || "").toLowerCase().includes(q)
    );
  }, [candidates, parentSearch]);

  const selectedParent = useMemo(
    () => candidates.find((c) => c.id === parentId) ?? null,
    [candidates, parentId]
  );

  const sortedComments = useMemo(
    () => comments.slice().sort((a, b) => (a.created_at < b.created_at ? 1 : -1)),
    [comments]
  );

  const statusNameById = useMemo(() => {
    const m = new Map<number, string>();
    for (const s of statuses) m.set(s.id, s.name);
    return m;
  }, [statuses]);

  function validate(): string {
    if (!title.trim()) return "Title required";
    if (statusId == null) return "Status required";
    if (!PRIORITIES.includes(priority as (typeof PRIORITIES)[number])) return "Invalid priority";
    if (level > 0 && parentId == null) {
      return level === 1 ? "Parent Task required for Subtask" : "Parent Subtask required for Microtask";
    }
    if (level === 0 && parentId != null) return "Top-level Task cannot have a parent";
    return "";
  }

  async function save() {
    if (!auth.accessToken) return;
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    const headers = {
      "Content-Type": "application/json",
      ...authHeaders(auth.accessToken),
    };
    try {
      if (!isEdit) {
        const body: Record<string, unknown> = {
          project_id: Number(projectId),
          title: title.trim(),
          description_md: description,
          status_id: statusId,
          priority,
          start_date: taskStart || today,
          due_date: taskDue || null,
          assignee_ids: assigneeId != null ? [assigneeId] : [],
          watcher_ids: watcherIds,
        };
        if (level > 0 && parentId != null) body.parent_id = parentId;
        const r = await fetch("/api/v1/tasks", { method: "POST", headers, body: JSON.stringify(body) });
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          throw new Error(err.detail || `Create failed: ${r.status}`);
        }
        const created: TaskOut = await r.json();
        let warnings: string[] = [];
        const commentText = initialComment.trim();
        if (commentText) {
          const cr = await fetch(`/api/v1/tasks/${created.id}/comments`, {
            method: "POST",
            headers,
            body: JSON.stringify({ body_md: commentText }),
          });
          if (!cr.ok) warnings.push("Task saved but initial comment failed");
        }
        const periodTouched =
          (periodStart || "") !== (taskStart || "") || periodDue !== "" || periodActual !== "";
        if (periodTouched && statusId != null) {
          const sr = await fetch(`/api/v1/tasks/${created.id}/status`, {
            method: "POST",
            headers,
            body: JSON.stringify({
              status_id: statusId,
              start_date: periodStart || null,
              due_date: periodDue || null,
              actual_end_date: periodActual || null,
            }),
          });
          if (!sr.ok) warnings.push("Task saved but Status period dates failed");
        }
        if (warnings.length > 0) setNotice(warnings.join(". "));
        onCreated?.(created.id);
        if (warnings.length === 0) onClose();
        return;
      }
      // ---- edit ----
      if (taskId == null) throw new Error("Missing task id");
      const put = await fetch(`/api/v1/tasks/${taskId}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({
          title: title.trim(),
          description_md: description,
          priority,
          start_date: taskStart || null,
          due_date: taskDue || null,
          assignee_ids: assigneeId != null ? [assigneeId] : [],
          watcher_ids: watcherIds,
        }),
      });
      if (!put.ok) {
        const err = await put.json().catch(() => ({}));
        throw new Error(err.detail || `Save failed: ${put.status}`);
      }
      const updated: TaskOut = await put.json();
      const statusChanged = statusId != null && statusId !== updated.status_id;
      const currPeriod = updated.status_periods?.find((p) => p.status_id === updated.status_id);
      const periodChanged =
        (periodStart || "") !== (currPeriod?.start_date || updated.start_date || "") ||
        (periodDue || "") !== (currPeriod?.due_date || "") ||
        (periodActual || "") !== (currPeriod?.actual_end_date || "");
      if ((statusChanged && statusId != null) || periodChanged) {
        const sr = await fetch(`/api/v1/tasks/${taskId}/status`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            status_id: statusId ?? updated.status_id,
            start_date: periodStart || null,
            due_date: periodDue || null,
            actual_end_date: periodActual || null,
          }),
        });
        if (!sr.ok) {
          const err = await sr.json().catch(() => ({}));
          throw new Error(err.detail || `Status period save failed: ${sr.status}`);
        }
      }
      onUpdated?.();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function addComment() {
    if (!auth.accessToken || taskId == null || !newComment.trim()) return;
    setError("");
    const r = await fetch(`/api/v1/tasks/${taskId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders(auth.accessToken) },
      body: JSON.stringify({ body_md: newComment.trim() }),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      setError(err.detail || `Comment failed: ${r.status}`);
      return;
    }
    const c: CommentOut = await r.json();
    setComments((prev) => [...prev, c]);
    setNewComment("");
  }

  async function saveEditedComment(id: number) {
    if (!auth.accessToken || taskId == null || !editingBody.trim()) return;
    const r = await fetch(`/api/v1/tasks/${taskId}/comments/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeaders(auth.accessToken) },
      body: JSON.stringify({ body_md: editingBody.trim() }),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      setError(err.detail || `Edit failed: ${r.status}`);
      return;
    }
    const c: CommentOut = await r.json();
    setComments((prev) => prev.map((x) => (x.id === id ? c : x)));
    setEditingCommentId(null);
    setEditingBody("");
  }

  async function deleteComment(id: number) {
    if (!auth.accessToken || taskId == null) return;
    if (!window.confirm("Delete this comment?")) return;
    const r = await fetch(`/api/v1/tasks/${taskId}/comments/${id}`, {
      method: "DELETE",
      headers: authHeaders(auth.accessToken),
    });
    if (!r.ok && r.status !== 204) {
      const err = await r.json().catch(() => ({}));
      setError(err.detail || `Delete failed: ${r.status}`);
      return;
    }
    setComments((prev) => prev.filter((x) => x.id !== id));
  }

  const canSave = !saving && title.trim().length > 0 && (level === 0 || parentId != null) && statusId != null;

  // Current user id for own-comment gating (GET /auth/me returns {id,...}).
  useEffect(() => {
    if (!auth.accessToken) return;
    fetch("/api/v1/auth/me", { headers: authHeaders(auth.accessToken) })
      .then((r) => (r.ok ? r.json() : null))
      .then((me) => {
        if (me && typeof me.id === "number") setCurrentUserId(me.id);
      })
      .catch(() => undefined);
  }, [auth.accessToken]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 sm:p-6 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label={isEdit ? "Edit task" : "Create task"}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void save();
      }}
    >
      <div className="relative w-full max-w-5xl flex flex-col bg-surface-container-lowest rounded-2xl shadow-2xl border border-subtle overflow-hidden my-auto max-h-[92vh]">
        {/* Header: breadcrumb + level switcher + parent picker */}
        <div className="px-6 py-4 border-b border-subtle bg-surface-container-lowest flex flex-col gap-3">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap text-xs">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-surface-container text-on-surface-variant">
                Category: <strong className="text-on-surface font-semibold">{categoryName || "…"}</strong>
              </span>
              <span className="text-outline">›</span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-surface-container text-on-surface-variant">
                Project:{" "}
                <strong className="text-on-surface font-semibold">
                  {projectName || "…"} {projectCode ? `(${projectCode})` : ""}
                </strong>
              </span>
              {isEdit && taskId != null && (
                <span className="px-2 py-0.5 rounded bg-primary-fixed/50 text-primary font-mono font-semibold">
                  #{taskId}
                </span>
              )}
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors"
              title="Close (Esc)"
              type="button"
            >
              ✕
            </button>
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-subtle">
            <div
              className="flex items-center p-1 rounded-xl bg-surface-container border border-subtle shrink-0"
              role="tablist"
              aria-label="Item level"
            >
              {(Object.keys(LEVEL_LABEL) as unknown as TaskLevel[]).map((lv) => {
                const n = Number(lv) as TaskLevel;
                const active = level === n;
                const disabled = isEdit; // level locked in edit (Q7)
                return (
                  <button
                    key={n}
                    role="tab"
                    aria-selected={active}
                    disabled={disabled}
                    onClick={() => {
                      setLevel(n);
                      if (n === 0) setParentId(null);
                    }}
                    title={disabled ? "Level locked in edit" : `Create as ${LEVEL_LABEL[n]}`}
                    type="button"
                    className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      active
                        ? "bg-surface-container-lowest text-primary font-semibold shadow-xs border border-subtle"
                        : "text-on-surface-variant hover:text-on-surface disabled:opacity-50"
                    }`}
                  >
                    {LEVEL_LABEL[n]}
                  </button>
                );
              })}
            </div>
            {level > 0 ? (
              <div className="flex items-center gap-2 min-w-0 flex-1 sm:max-w-md">
                <span className="text-on-surface-variant text-[11px] shrink-0 uppercase tracking-wider">
                  {level === 1 ? "Parent Task:" : "Parent Subtask:"}
                </span>
                {isEdit ? (
                  <span className="text-xs text-on-surface truncate">
                    {parentTitle ? `#${parentId} ${parentTitle}` : parentId != null ? `#${parentId}` : "—"}
                  </span>
                ) : candidates.length === 0 && !loading ? (
                  <span className="text-xs text-amber-300">
                    {level === 1 ? "Create a Task first — no parent Tasks yet." : "Create a Subtask first — no parent Subtasks yet."}
                  </span>
                ) : (
                  <select
                    value={parentId ?? ""}
                    onChange={(e) => setParentId(e.target.value ? Number(e.target.value) : null)}
                    className="min-w-0 flex-1 text-xs bg-surface-container border border-subtle rounded-lg px-2 py-1.5 text-on-surface"
                    aria-label={level === 1 ? "Parent Task" : "Parent Subtask"}
                  >
                    <option value="">Select parent…</option>
                    {filteredCandidates.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.wbs ? `${c.wbs} · ` : `#${c.id} · `} {c.title}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            ) : (
              <span className="text-xs text-on-surface-variant">Top-level Task in this Project (no parent).</span>
            )}
          </div>
          {!isEdit && level > 0 && candidates.length > 5 && (
            <input
              value={parentSearch}
              onChange={(e) => setParentSearch(e.target.value)}
              placeholder="Filter parents by title, WBS, or id…"
              className="w-full sm:max-w-xs text-xs bg-surface-container border border-subtle rounded-lg px-2.5 py-1.5 text-on-surface"
            />
          )}
        </div>

        {/* Body */}
        <div className="p-6 grid grid-cols-1 lg:grid-cols-12 gap-8 overflow-y-auto flex-1">
          <div className="lg:col-span-8 space-y-6 min-w-0">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-semibold text-primary px-2 py-0.5 rounded bg-primary-fixed/50">
                  {wbsPreview}
                </span>
                <span className="text-[11px] text-on-surface-variant">
                  {LEVEL_LABEL[level]} · {isEdit ? "edit" : "create"}
                  {selectedParent && !isEdit ? ` under #${selectedParent.id}` : ""}
                </span>
              </div>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={`${LEVEL_LABEL[level]} title…`}
                maxLength={256}
                className="w-full text-xl font-bold text-on-surface bg-transparent border-0 border-b border-transparent hover:border-subtle focus:border-primary p-0 pb-2 outline-none placeholder:text-outline"
              />
              {!title.trim() && (
                <p className="text-[11px] text-error">Title required (max 256).</p>
              )}
            </div>
            <div className="space-y-2">
              <label className="text-[11px] font-semibold text-on-surface uppercase tracking-wider">
                Description
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Detailed description, execution notes, or acceptance criteria…"
                rows={3}
                maxLength={10000}
                className="w-full p-3 rounded-xl bg-surface-container-lowest border border-subtle text-sm text-on-surface placeholder:text-outline focus:border-primary outline-none resize-none"
              />
            </div>
            <div className="space-y-3 pt-4 border-t border-subtle">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-on-surface">Comments & Activity</h3>
                <span className="px-2 py-0.5 rounded-full bg-surface-container text-on-surface text-xs">
                  {isEdit ? comments.length : initialComment.trim() ? 1 : 0}
                </span>
              </div>
              {!isEdit ? (
                <div className="space-y-2">
                  <textarea
                    value={initialComment}
                    onChange={(e) => setInitialComment(e.target.value)}
                    placeholder="Optional initial comment (saved with timestamp on create)…"
                    rows={2}
                    maxLength={10000}
                    className="w-full p-3 rounded-xl bg-surface-container-lowest border border-subtle text-sm text-on-surface placeholder:text-outline focus:border-primary outline-none resize-none"
                  />
                  <p className="text-[11px] text-on-surface-variant">
                    Saved as the first comment by you, timestamped on the server.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="space-y-2 max-h-56 overflow-y-auto">
                    {sortedComments.length === 0 && (
                      <p className="text-xs text-outline">No comments yet.</p>
                    )}
                    {sortedComments.map((c) => {
                      const own = currentUserId != null && c.author_id === currentUserId;
                      const isEditing = editingCommentId === c.id;
                      return (
                        <div key={c.id} className="p-3 rounded-xl bg-surface-container/60 border border-subtle space-y-1">
                          <div className="flex items-center justify-between text-[11px] text-on-surface-variant">
                            <span>
                              Author #{c.author_id} · {new Date(c.created_at).toLocaleString()}
                            </span>
                            {own && !isEditing && (
                              <span className="flex gap-2">
                                <button
                                  onClick={() => {
                                    setEditingCommentId(c.id);
                                    setEditingBody(c.body_md);
                                  }}
                                  className="text-primary hover:underline"
                                  type="button"
                                >
                                  Edit
                                </button>
                                <button
                                  onClick={() => void deleteComment(c.id)}
                                  className="text-error hover:underline"
                                  type="button"
                                >
                                  Delete
                                </button>
                              </span>
                            )}
                          </div>
                          {isEditing ? (
                            <div className="flex gap-2">
                              <input
                                value={editingBody}
                                onChange={(e) => setEditingBody(e.target.value)}
                                className="flex-1 text-xs bg-surface-container-lowest border border-subtle rounded px-2 py-1.5 text-on-surface"
                              />
                              <button
                                onClick={() => void saveEditedComment(c.id)}
                                className="px-2 py-1 rounded bg-primary-container text-on-primary text-xs"
                                type="button"
                              >
                                Save
                              </button>
                              <button
                                onClick={() => {
                                  setEditingCommentId(null);
                                  setEditingBody("");
                                }}
                                className="px-2 py-1 rounded bg-surface-container text-xs text-on-surface-variant"
                                type="button"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <p className="text-sm text-on-surface whitespace-pre-wrap">{c.body_md}</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex gap-2">
                    <input
                      value={newComment}
                      onChange={(e) => setNewComment(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void addComment();
                      }}
                      placeholder="Write a comment…"
                      maxLength={10000}
                      className="flex-1 text-sm bg-surface-container-lowest border border-subtle rounded-xl px-3 py-2 text-on-surface placeholder:text-outline"
                    />
                    <button
                      onClick={() => void addComment()}
                      disabled={!newComment.trim()}
                      className="px-4 py-2 rounded-xl bg-surface-container hover:bg-primary-container text-on-surface hover:text-on-primary text-xs font-semibold disabled:opacity-50"
                      type="button"
                    >
                      Comment
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Right rail */}
          <div className="lg:col-span-4 space-y-5 lg:border-l lg:border-subtle lg:pl-6">
            <h3 className="text-[11px] font-semibold text-on-surface uppercase tracking-wider">
              Properties & Schedule
            </h3>
            <div className="space-y-3">
              <label className="block text-xs text-on-surface-variant">
                Status (from Category profile, grouped by Stage)
                <select
                  value={statusId ?? ""}
                  onChange={(e) => setStatusId(e.target.value ? Number(e.target.value) : null)}
                  className="mt-1 w-full text-sm bg-surface-container border border-subtle rounded-lg px-2.5 py-1.5 text-on-surface"
                >
                  <option value="">Select status…{defaultStatusName ? ` (default ${defaultStatusName})` : ""}</option>
                  {stages.length > 0 ? (
                    <>
                      {stages.map((st) => {
                        const leafs = statuses.filter((s) => s.stage_id === st.id);
                        if (leafs.length === 0) return null;
                        return (
                          <optgroup key={st.id} label={st.name}>
                            {leafs.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name}
                              </option>
                            ))}
                          </optgroup>
                        );
                      })}
                      {statuses
                        .filter((s) => !s.stage_id)
                        .map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                    </>
                  ) : (
                    statuses.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))
                  )}
                </select>
              </label>
              <label className="block text-xs text-on-surface-variant">
                Priority
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                  className="mt-1 w-full text-sm bg-surface-container border border-subtle rounded-lg px-2.5 py-1.5 text-on-surface"
                >
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs text-on-surface-variant">
                Assignee (single, optional)
                <select
                  value={assigneeId ?? ""}
                  onChange={(e) => setAssigneeId(e.target.value ? Number(e.target.value) : null)}
                  className="mt-1 w-full text-sm bg-surface-container border border-subtle rounded-lg px-2.5 py-1.5 text-on-surface"
                >
                  <option value="">Unassigned</option>
                  {members.map((m) => (
                    <option key={m.user_id} value={m.user_id}>
                      User #{m.user_id} ({m.role})
                    </option>
                  ))}
                </select>
              </label>
              <div className="text-xs text-on-surface-variant">
                <span className="block mb-1">Watchers ({watcherIds.length})</span>
                <div className="space-y-1 max-h-24 overflow-y-auto border border-subtle rounded-lg p-2">
                  {members.length === 0 && <span className="text-[11px] text-outline">No members loaded.</span>}
                  {members.map((m) => (
                    <label key={m.user_id} className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={watcherIds.includes(m.user_id)}
                        onChange={() =>
                          setWatcherIds((prev) =>
                            prev.includes(m.user_id) ? prev.filter((x) => x !== m.user_id) : [...prev, m.user_id]
                          )
                        }
                      />
                      User #{m.user_id} ({m.role})
                    </label>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="block text-xs text-on-surface-variant">
                  Task Start
                  <input
                    type="date"
                    value={taskStart}
                    onChange={(e) => setTaskStart(e.target.value)}
                    className="mt-1 w-full text-xs bg-surface-container border border-subtle rounded-lg px-2 py-1.5 text-on-surface"
                  />
                </label>
                <label className="block text-xs text-on-surface-variant">
                  Task Due
                  <input
                    type="date"
                    value={taskDue}
                    onChange={(e) => setTaskDue(e.target.value)}
                    className="mt-1 w-full text-xs bg-surface-container border border-subtle rounded-lg px-2 py-1.5 text-on-surface"
                  />
                </label>
              </div>
              <div className="rounded-xl bg-surface-container/60 border border-subtle p-3 space-y-2">
                <span className="text-[11px] font-semibold text-on-surface uppercase tracking-wider">
                  Current Status period{statusId != null ? `: ${statusNameById.get(statusId) ?? statusId}` : ""}
                </span>
                <div className="grid grid-cols-1 gap-2">
                  <label className="block text-xs text-on-surface-variant">
                    Period Start
                    <input
                      type="date"
                      value={periodStart}
                      onChange={(e) => setPeriodStart(e.target.value)}
                      className="mt-1 w-full text-xs bg-surface-container-lowest border border-subtle rounded-lg px-2 py-1.5 text-on-surface"
                    />
                  </label>
                  <label className="block text-xs text-on-surface-variant">
                    Period Due (planned end)
                    <input
                      type="date"
                      value={periodDue}
                      onChange={(e) => setPeriodDue(e.target.value)}
                      className="mt-1 w-full text-xs bg-surface-container-lowest border border-subtle rounded-lg px-2 py-1.5 text-on-surface"
                    />
                  </label>
                  <label className="block text-xs text-on-surface-variant">
                    Actual End
                    <input
                      type="date"
                      value={periodActual}
                      onChange={(e) => setPeriodActual(e.target.value)}
                      className="mt-1 w-full text-xs bg-surface-container-lowest border border-subtle rounded-lg px-2 py-1.5 text-on-surface"
                    />
                  </label>
                </div>
                {isEdit && pastPeriods.length > 0 && (
                  <div>
                    <button
                      onClick={() => setShowPastPeriods((v) => !v)}
                      className="text-[11px] text-primary hover:underline"
                      type="button"
                    >
                      {showPastPeriods ? "Hide" : "Show"} past periods ({pastPeriods.length})
                    </button>
                    {showPastPeriods && (
                      <ul className="mt-1 space-y-1 text-[11px] font-mono text-on-surface-variant">
                        {pastPeriods.map((p) => (
                          <li key={p.id} className="flex justify-between border-b border-subtle py-0.5">
                            <span>{statusNameById.get(p.status_id) ?? `Status #${p.status_id}`}</span>
                            <span>
                              {p.start_date || "—"} → {p.due_date || p.actual_end_date || "—"}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-subtle flex items-center justify-between gap-3 flex-wrap bg-surface-container-lowest shrink-0">
          <div className="text-xs text-on-surface-variant">
            {loading ? (
              "Loading profile…"
            ) : (
              <>
                {LEVEL_LABEL[level]} in <strong className="text-on-surface">{projectCode || `Project ${projectId}`}</strong>
                {!isEdit && selectedParent ? ` under #${selectedParent.id}` : ""}
              </>
            )}
          </div>
          <div className="flex flex-col items-end gap-1">
            {(error || notice) && (
              <div role={error ? "alert" : "status"} className={`text-xs ${error ? "text-error" : "text-amber-300"}`}>
                {error || notice}
              </div>
            )}
            <div className="flex items-center gap-2">
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-xl text-on-surface hover:bg-surface-container text-xs"
                type="button"
              >
                Cancel
              </button>
              <button
                onClick={() => void save()}
                disabled={!canSave}
                title="⌘/Ctrl+Enter to save"
                className="px-5 py-2 rounded-xl bg-primary-container text-on-primary hover:bg-primary text-xs font-semibold disabled:opacity-50 flex items-center gap-2"
                type="button"
              >
                {saving ? "Saving…" : isEdit ? "Save Changes" : `Create ${LEVEL_LABEL[level]}`}
                <kbd className="px-1.5 py-0.5 bg-primary/40 text-on-primary rounded border border-white/20 text-[10px]">
                  ⌘↵
                </kbd>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
