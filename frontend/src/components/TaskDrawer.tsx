import React, { useEffect, useState } from "react";
import { useAuth } from "../stores/auth";

interface TaskDrawerProps {
  taskId: number;
  projectId: string | number;
  onClose: () => void;
  onUpdated: () => void;
}

interface StatusPeriod {
  id: number;
  task_id: number;
  status_id: number;
  start_date?: string | null;
  due_date?: string | null;
  actual_end_date?: string | null;
  actor_id?: number | null;
  created_at: string;
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
  estimate_mins?: number | null;
  time_spent_mins: number;
  created_by?: number | null;
  updated_at: string;
  assignee_ids: number[];
  watcher_ids: number[];
  tag_names: string[];
  blocked_by_ids: number[];
  is_blocked: boolean;
  status_periods: StatusPeriod[];
}

interface CommentOut {
  id: number;
  task_id: number;
  parent_id?: number | null;
  author_id: number;
  body_md: string;
  mentions?: number[];
  created_at: string;
}

interface AttachmentOut {
  id: number;
  task_id: number;
  filename: string;
  path: string;
  size: number;
  uploaded_by: number;
  created_at: string;
}

interface CustomFieldVal {
  def_id: number;
  key: string;
  label: string;
  type: string;
  required: boolean;
  value: string;
}

interface HistoryOut {
  id: number;
  task_id: number;
  from_status_id?: number | null;
  to_status_id: number;
  actor_id?: number | null;
  at: string;
}

interface ProjectStatus {
  id: number;
  name: string;
  color?: string;
  shade?: string | null;
  stage_id?: number | null;
  order: number;
  is_done?: boolean;
}

interface StageInfo {
  id: number;
  profile_id: number;
  name: string;
  order: number;
  color_base: string;
}

interface MemberInfo {
  user_id: number;
  role: string;
}

export default function TaskDrawer({ taskId, projectId, onClose, onUpdated }: TaskDrawerProps) {
  const auth = useAuth();
  const [task, setTask] = useState<TaskOut | null>(null);
  const [statuses, setStatuses] = useState<ProjectStatus[]>([]);
  const [stages, setStages] = useState<StageInfo[]>([]);
  const [members, setMembers] = useState<MemberInfo[]>([]);
  const [comments, setComments] = useState<CommentOut[]>([]);
  const [attachments, setAttachments] = useState<AttachmentOut[]>([]);
  const [customFields, setCustomFields] = useState<CustomFieldVal[]>([]);
  const [history, setHistory] = useState<HistoryOut[]>([]);
  const [subtasks, setSubtasks] = useState<TaskOut[]>([]);

  const [activeTab, setActiveTab] = useState<"comments" | "attachments" | "audit">("comments");
  const [commentInput, setCommentInput] = useState<string>("");
  const [replyToId, setReplyToId] = useState<number | null>(null);
  const [newSubtaskTitle, setNewSubtaskTitle] = useState<string>("");
  const [newSubtaskStart, setNewSubtaskStart] = useState<string>("");
  const [parentTask, setParentTask] = useState<TaskOut | null>(null);
  const [blockedInput, setBlockedInput] = useState<string>("");
  const [tagsInput, setTagsInput] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  // Status period form state
  const [selectedStatusId, setSelectedStatusId] = useState<number>(0);
  const [periodStart, setPeriodStart] = useState<string>("");
  const [periodDue, setPeriodDue] = useState<string>("");
  const [periodActual, setPeriodActual] = useState<string>("");

  const fetchTaskDetails = () => {
    if (!auth.accessToken) return;
    setLoading(true);
    Promise.all([
      fetch(`/api/v1/tasks/${taskId}`, { headers: { Authorization: `Bearer ${auth.accessToken}` } }).then((r) => r.ok ? r.json() : null),
      fetch(`/api/v1/tasks/${taskId}/comments`, { headers: { Authorization: `Bearer ${auth.accessToken}` } }).then((r) => r.ok ? r.json() : []),
      fetch(`/api/v1/tasks/${taskId}/attachments`, { headers: { Authorization: `Bearer ${auth.accessToken}` } }).then((r) => r.ok ? r.json() : []),
      fetch(`/api/v1/tasks/${taskId}/custom-fields`, { headers: { Authorization: `Bearer ${auth.accessToken}` } }).then((r) => r.ok ? r.json() : []),
      fetch(`/api/v1/tasks/${taskId}/history`, { headers: { Authorization: `Bearer ${auth.accessToken}` } }).then((r) => r.ok ? r.json() : []),
      fetch(`/api/v1/tasks/${taskId}/subtasks`, { headers: { Authorization: `Bearer ${auth.accessToken}` } }).then((r) => r.ok ? r.json() : []),
      fetch(`/api/v1/projects/${projectId}`, { headers: { Authorization: `Bearer ${auth.accessToken}` } }).then((r) => r.ok ? r.json() : null),
      fetch(`/api/v1/projects/${projectId}/members`, { headers: { Authorization: `Bearer ${auth.accessToken}` } }).then((r) => r.ok ? r.json() : []),
    ])
      .then(async ([tData, cData, aData, cfData, hData, subData, projData, memData]) => {
        if (tData) {
          setTask(tData);
          setSelectedStatusId(tData.status_id);
          setPeriodStart(tData.start_date || "");
          setPeriodDue(tData.due_date || "");
          setPeriodActual("");
          setTagsInput((tData.tag_names || []).join(", "));
          setBlockedInput("");
          // Find period for current status
          const currPeriod = tData.status_periods?.find((p: StatusPeriod) => p.status_id === tData.status_id);
          if (currPeriod) {
            setPeriodStart(currPeriod.start_date || tData.start_date || "");
            setPeriodDue(currPeriod.due_date || "");
            setPeriodActual(currPeriod.actual_end_date || "");
          }
          // Fetch parent chain for hierarchy breadcrumb (0 > 1.1 > 1.1.1)
          if (tData.parent_id) {
            try {
              const pRes = await fetch(`/api/v1/tasks/${tData.parent_id}`, {
                headers: { Authorization: `Bearer ${auth.accessToken}` },
              });
              if (pRes.ok) {
                const pData = await pRes.json();
                setParentTask(pData);
              } else {
                setParentTask(null);
              }
            } catch {
              setParentTask(null);
            }
          } else {
            setParentTask(null);
          }
        }
        setComments(cData);
        setAttachments(aData);
        setCustomFields(cfData);
        setHistory(hData);
        setSubtasks(subData);
        setMembers(memData);

        if (projData) {
          // U3: Profile resolves live via parent Category (Project → Category → Profile).
          // Older projects may still carry status_profile_id; prefer it when present.
          let profileId: number | null = projData.status_profile_id ?? null;
          if (!profileId && projData.category_id) {
            try {
              const catRes = await fetch(`/api/v1/categories/${projData.category_id}`, {
                headers: { Authorization: `Bearer ${auth.accessToken}` },
              });
              if (catRes.ok) {
                const catData = await catRes.json();
                profileId = catData.status_profile_id ?? null;
              }
            } catch {
              profileId = null;
            }
          }
          if (profileId) {
            const stRes = await fetch(`/api/v1/status-profiles/${profileId}`, {
              headers: { Authorization: `Bearer ${auth.accessToken}` },
            });
            if (stRes.ok) {
              const stData = await stRes.json();
              setStatuses(stData.statuses || []);
              setStages(stData.stages || []);
            }
          }
        }
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message || "Failed to load task details");
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchTaskDetails();
  }, [taskId]);

  const parseMentions = (text: string): number[] => {
    const ids: number[] = [];
    const re = /@(\d+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const id = Number(m[1]);
      if (!Number.isNaN(id) && !ids.includes(id)) ids.push(id);
    }
    return ids;
  };

  const toggleId = (list: number[], id: number): number[] =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

  const handleSaveTask = async () => {
    if (!auth.accessToken || !task) return;
    try {
      const tag_names = tagsInput
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t.length > 0);
      // PUT core fields + relations (no status_id here: status changes go
      // through POST /status below so only one history event is written).
      const putRes = await fetch(`/api/v1/tasks/${taskId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth.accessToken}`,
        },
        body: JSON.stringify({
          title: task.title,
          description_md: task.description_md,
          priority: task.priority,
          start_date: task.start_date,
          due_date: task.due_date,
          assignee_ids: task.assignee_ids,
          watcher_ids: task.watcher_ids,
          blocked_by_ids: task.blocked_by_ids,
          tag_names,
        }),
      });
      if (!putRes.ok) {
        const errText = await putRes.text();
        throw new Error(`Failed to save task: ${errText}`);
      }
      // POST status + period only when something in the period box changed,
      // so date-only edits still upsert the period with a single history event.
      const currPeriod = task.status_periods?.find((p) => p.status_id === task.status_id);
      const statusChanged = selectedStatusId !== task.status_id;
      const periodChanged =
        (periodStart || "") !== (currPeriod?.start_date || task.start_date || "") ||
        (periodDue || "") !== (currPeriod?.due_date || "") ||
        (periodActual || "") !== (currPeriod?.actual_end_date || "");
      if (statusChanged || periodChanged) {
        const stRes = await fetch(`/api/v1/tasks/${taskId}/status`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${auth.accessToken}`,
          },
          body: JSON.stringify({
            status_id: selectedStatusId,
            start_date: periodStart || null,
            due_date: periodDue || null,
            actual_end_date: periodActual || null,
          }),
        });
        if (!stRes.ok) {
          const errText = await stRes.text();
          throw new Error(`Failed to save status period: ${errText}`);
        }
      }
      onUpdated();
      fetchTaskDetails();
    } catch (err) {
      alert((err as Error).message);
    }
  };

  const handleAddComment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth.accessToken || !commentInput.trim()) return;
    fetch(`/api/v1/tasks/${taskId}/comments`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth.accessToken}`,
      },
      body: JSON.stringify({
        body_md: commentInput,
        parent_id: replyToId,
        mentions: parseMentions(commentInput),
      }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((newC) => {
        if (newC) {
          setComments([...comments, newC]);
          setCommentInput("");
          setReplyToId(null);
        }
      });
  };

  const handleUploadAttachment = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !auth.accessToken) return;
    if (file.size > 10 * 1024 * 1024) {
      alert("File exceeds 10MB limit");
      return;
    }
    const formData = new FormData();
    formData.append("file", file);
    fetch(`/api/v1/tasks/${taskId}/attachments`, {
      method: "POST",
      headers: { Authorization: `Bearer ${auth.accessToken}` },
      body: formData,
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((newAtt) => {
        if (newAtt) setAttachments([...attachments, newAtt]);
      });
  };

  const handleDeleteAttachment = (attId: number) => {
    if (!auth.accessToken) return;
    fetch(`/api/v1/tasks/${taskId}/attachments/${attId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${auth.accessToken}` },
    }).then((r) => {
      if (r.ok) setAttachments(attachments.filter((a) => a.id !== attId));
    });
  };

  const handleCreateSubtask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth.accessToken || !newSubtaskTitle.trim() || !task) return;
    if (task.depth >= 2) {
      alert("Hierarchy capped at depth 2 (Microtask leaf cannot gain children).");
      return;
    }
    fetch(`/api/v1/tasks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth.accessToken}`,
      },
      body: JSON.stringify({
        project_id: Number(projectId),
        parent_id: task.id,
        title: newSubtaskTitle,
        start_date: newSubtaskStart || task.start_date,
        status_id: selectedStatusId,
      }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((sub) => {
        if (sub) {
          setSubtasks([...subtasks, sub]);
          setNewSubtaskTitle("");
          setNewSubtaskStart("");
        }
      });
  };

  const handleCustomFieldChange = (defId: number, val: string) => {
    if (!auth.accessToken) return;
    const updated = customFields.map((cf) => (cf.def_id === defId ? { ...cf, value: val } : cf));
    setCustomFields(updated);
    const payload: Record<number, string> = {};
    updated.forEach((cf) => {
      payload[cf.def_id] = cf.value;
    });
    fetch(`/api/v1/tasks/${taskId}/custom-fields`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth.accessToken}`,
      },
      body: JSON.stringify(payload),
    });
  };

  if (!task && loading) {
    return (
      <div className="fixed inset-0 z-50 bg-black/60 flex justify-end">
        <div className="w-full max-w-2xl bg-surface-container-lowest text-on-surface p-6">Loading task drawer...</div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex justify-end backdrop-blur-sm animate-fadeIn">
      <div className="w-full max-w-2xl bg-surface-container-lowest border-l border-subtle text-on-surface flex flex-col h-full shadow-2xl overflow-y-auto">
        {/* Top Bar */}
        <div className="px-6 py-4 bg-surface border-b border-subtle flex items-center justify-between sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <span className="font-mono text-primary text-sm font-bold">#{task?.id}</span>
            <span className="px-2 py-0.5 rounded text-xs font-semibold bg-surface-container text-on-surface-variant">
              Depth {task?.depth} ({task?.depth === 0 ? "Task" : task?.depth === 1 ? "Subtask" : "Microtask"})
            </span>
            <select
              value={task?.priority || "normal"}
              onChange={(e) => setTask(task ? { ...task, priority: e.target.value } : null)}
              className="bg-surface-container border border-subtle text-xs px-2 py-1 rounded text-on-surface"
            >
              <option value="urgent">Urgent</option>
              <option value="high">High</option>
              <option value="normal">Normal</option>
              <option value="low">Low</option>
            </select>
            <span className="text-xs text-on-surface-variant">Watchers: {task?.watcher_ids?.length || 0}</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low transition-colors"
          >
            ✕
          </button>
        </div>

        {error && <div className="p-4 bg-error-container text-error text-xs">{error}</div>}

        <div className="p-6 space-y-6 flex-1">
          {/* Title & Whole-Process Start Banner */}
          <div className="space-y-3 bg-surface-container-low/60 p-4 rounded-lg border border-subtle">
            <div>
              <label className="text-xs text-on-surface-variant font-semibold block mb-1">Task Title</label>
              <input
                type="text"
                value={task?.title || ""}
                onChange={(e) => setTask(task ? { ...task, title: e.target.value } : null)}
                className="w-full bg-surface-container-lowest border border-subtle rounded px-3 py-2 text-sm text-on-primary focus:outline-none focus:border-primary-container"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-on-surface-variant font-semibold block mb-1">Whole-Process Start Date (Requirement §4.4)</label>
                <input
                  type="date"
                  value={task?.start_date || ""}
                  onChange={(e) => setTask(task ? { ...task, start_date: e.target.value } : null)}
                  className="w-full bg-surface-container-lowest border border-subtle rounded px-3 py-1.5 text-xs text-on-primary"
                />
              </div>
              <div>
                <label className="text-xs text-on-surface-variant font-semibold block mb-1">Due Date (Planned)</label>
                <input
                  type="date"
                  value={task?.due_date || ""}
                  onChange={(e) => setTask(task ? { ...task, due_date: e.target.value } : null)}
                  className="w-full bg-surface-container-lowest border border-subtle rounded px-3 py-1.5 text-xs text-on-primary"
                />
              </div>
            </div>
            <div>
              <label className="text-xs text-on-surface-variant font-semibold block mb-1">Description (Markdown)</label>
              <textarea
                rows={3}
                value={task?.description_md || ""}
                onChange={(e) => setTask(task ? { ...task, description_md: e.target.value } : null)}
                className="w-full bg-surface-container-lowest border border-subtle rounded px-3 py-2 text-xs text-on-primary focus:outline-none focus:border-primary-container"
              />
            </div>
          </div>

          {/* Status Period Execution Box */}
          <div className="bg-surface-container-low/60 p-4 rounded-lg border border-subtle space-y-4">
            <h3 className="text-xs uppercase tracking-wider text-primary font-bold">Status Period & Execution</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-on-surface-variant block mb-1">Current Status</label>
                <select
                  value={selectedStatusId}
                  onChange={(e) => setSelectedStatusId(Number(e.target.value))}
                  className="w-full bg-surface-container-lowest border border-subtle rounded px-3 py-1.5 text-xs text-on-primary"
                >
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
                        .map((st) => (
                          <option key={st.id} value={st.id}>
                            {st.name}
                          </option>
                        ))}
                    </>
                  ) : (
                    statuses.map((st) => (
                      <option key={st.id} value={st.id}>
                        {st.name}
                      </option>
                    ))
                  )}
                </select>
              </div>
              <div>
                <label className="text-xs text-on-surface-variant block mb-1">Status Period Start</label>
                <input
                  type="date"
                  value={periodStart}
                  onChange={(e) => setPeriodStart(e.target.value)}
                  className="w-full bg-surface-container-lowest border border-subtle rounded px-3 py-1.5 text-xs text-on-primary"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-on-surface-variant block mb-1">Planned Due</label>
                <input
                  type="date"
                  value={periodDue}
                  onChange={(e) => setPeriodDue(e.target.value)}
                  className="w-full bg-surface-container-lowest border border-subtle rounded px-3 py-1.5 text-xs text-on-primary"
                />
              </div>
              <div>
                <label className="text-xs text-on-surface-variant block mb-1">Actual End Date</label>
                <input
                  type="date"
                  value={periodActual}
                  onChange={(e) => setPeriodActual(e.target.value)}
                  className="w-full bg-surface-container-lowest border border-subtle rounded px-3 py-1.5 text-xs text-on-primary"
                />
              </div>
            </div>

            {/* Micro-bar: stacked per-Status segments */}
            <div>
              <span className="text-[11px] text-on-surface-variant font-semibold block mb-1">Period Micro-bar:</span>
              <div className="flex h-2 rounded overflow-hidden bg-surface-container-lowest border border-subtle">
                {task?.status_periods && task.status_periods.length > 0 ? (
                  task.status_periods.map((p) => {
                    const stObj = statuses.find((s) => s.id === p.status_id);
                    return (
                      <div
                        key={p.id}
                        title={`${stObj?.name || p.status_id}: ${p.start_date || "?"} → ${p.due_date || p.actual_end_date || "?"}`}
                        className={`flex-1 ${stObj?.is_done ? "bg-emerald-600" : "bg-primary-container"}`}
                      />
                    );
                  })
                ) : (
                  <div className="flex-1 bg-surface-container" />
                )}
              </div>
            </div>

            {/* Period History Table */}
            <div className="mt-2">
              <span className="text-[11px] text-on-surface-variant font-semibold block mb-1">Period History Logs:</span>
              <div className="bg-surface-container-lowest rounded border border-subtle max-h-32 overflow-y-auto text-xs font-mono">
                {task?.status_periods && task.status_periods.length > 0 ? (
                  task.status_periods.map((p) => {
                    const stObj = statuses.find((s) => s.id === p.status_id);
                    return (
                      <div key={p.id} className="px-3 py-1.5 border-b border-subtle flex justify-between text-on-surface-variant">
                        <span>{stObj?.name || `Status #${p.status_id}`}</span>
                        <span>{p.start_date || "—"} → {p.due_date || p.actual_end_date || "—"}</span>
                      </div>
                    );
                  })
                ) : (
                  <div className="px-3 py-2 text-outline">No periods recorded yet.</div>
                )}
              </div>
            </div>
          </div>

          {/* Metadata Grid: Assignees / Watchers / Blocked / Tags */}
          <div className="bg-surface-container-low/60 p-4 rounded-lg border border-subtle space-y-4">
            <h3 className="text-xs uppercase tracking-wider text-primary font-bold">Relations & Metadata</h3>
            {task?.is_blocked && (
              <div className="px-3 py-1.5 rounded bg-error-container/60 border border-rose-900 text-error text-xs">
                Blocked by Task #{task.blocked_by_ids.join(", #")}
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <span className="text-xs text-on-surface-variant block mb-1">Assignees</span>
                <div className="space-y-1 max-h-24 overflow-y-auto">
                  {members.length > 0 ? (
                    members.map((m) => (
                      <label key={m.user_id} className="flex items-center gap-2 text-xs text-on-surface-variant">
                        <input
                          type="checkbox"
                          checked={task?.assignee_ids.includes(m.user_id) || false}
                          onChange={() =>
                            setTask(task ? { ...task, assignee_ids: toggleId(task.assignee_ids, m.user_id) } : null)
                          }
                        />
                        User #{m.user_id} ({m.role})
                      </label>
                    ))
                  ) : (
                    <span className="text-[11px] text-outline">No project members loaded.</span>
                  )}
                </div>
              </div>
              <div>
                <span className="text-xs text-on-surface-variant block mb-1">Watchers ({task?.watcher_ids.length || 0})</span>
                <div className="space-y-1 max-h-24 overflow-y-auto">
                  {members.length > 0 ? (
                    members.map((m) => (
                      <label key={m.user_id} className="flex items-center gap-2 text-xs text-on-surface-variant">
                        <input
                          type="checkbox"
                          checked={task?.watcher_ids.includes(m.user_id) || false}
                          onChange={() =>
                            setTask(task ? { ...task, watcher_ids: toggleId(task.watcher_ids, m.user_id) } : null)
                          }
                        />
                        User #{m.user_id} ({m.role})
                      </label>
                    ))
                  ) : (
                    <span className="text-[11px] text-outline">No project members loaded.</span>
                  )}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-on-surface-variant block mb-1">Blocked by (task IDs)</label>
                <div className="flex flex-wrap gap-1 mb-2">
                  {(task?.blocked_by_ids || []).map((bid) => (
                    <span key={bid} className="px-2 py-0.5 rounded bg-error-container text-error text-[11px] font-mono flex items-center gap-1">
                      #{bid}
                      <button
                        onClick={() =>
                          setTask(task ? { ...task, blocked_by_ids: task.blocked_by_ids.filter((x) => x !== bid) } : null)
                        }
                        className="hover:text-on-surface"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    type="number"
                    placeholder="Task ID"
                    value={blockedInput}
                    onChange={(e) => setBlockedInput(e.target.value)}
                    className="flex-1 bg-surface-container-lowest border border-subtle rounded px-2 py-1 text-xs text-on-primary"
                  />
                  <button
                    onClick={() => {
                      const bid = Number(blockedInput);
                      if (!bid || !task) return;
                      if (bid === task.id) {
                        alert("Task cannot block itself");
                        return;
                      }
                      if (!task.blocked_by_ids.includes(bid)) {
                        setTask({ ...task, blocked_by_ids: [...task.blocked_by_ids, bid] });
                      }
                      setBlockedInput("");
                    }}
                    className="px-2 py-1 bg-surface-container rounded text-xs text-on-surface"
                  >
                    Add
                  </button>
                </div>
              </div>
              <div>
                <label className="text-xs text-on-surface-variant block mb-1">Tags (comma-separated)</label>
                <input
                  type="text"
                  value={tagsInput}
                  onChange={(e) => setTagsInput(e.target.value)}
                  placeholder="urgent, backend"
                  className="w-full bg-surface-container-lowest border border-subtle rounded px-3 py-1.5 text-xs text-on-primary"
                />
              </div>
            </div>
          </div>

          {/* Metadata Grid: Custom Fields */}
          {customFields.length > 0 && (
            <div className="bg-surface-container-low/60 p-4 rounded-lg border border-subtle space-y-3">
              <h3 className="text-xs uppercase tracking-wider text-primary font-bold">Template Custom Fields</h3>
              <div className="grid grid-cols-2 gap-4">
                {customFields.map((cf) => (
                  <div key={cf.def_id}>
                    <label className="text-xs text-on-surface-variant block mb-1">{cf.label}{cf.required && " *"}</label>
                    <input
                      type="text"
                      value={cf.value}
                      onChange={(e) => handleCustomFieldChange(cf.def_id, e.target.value)}
                      className="w-full bg-surface-container-lowest border border-subtle rounded px-3 py-1.5 text-xs text-on-primary"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Hierarchy Tree & Subtasks */}
          <div className="bg-surface-container-low/60 p-4 rounded-lg border border-subtle space-y-3">
            <h3 className="text-xs uppercase tracking-wider text-primary font-bold">Hierarchy & Subtasks (Depth {task?.depth}/2)</h3>
            <div className="text-[11px] font-mono text-on-surface-variant">
              {parentTask ? (
                <span>
                  #{parentTask.id} {parentTask.title} (Depth {parentTask.depth}) →{" "}
                  <strong className="text-on-surface">
                    #{task?.id} {task?.title} (Depth {task?.depth})
                  </strong>
                </span>
              ) : (
                <span>
                  <strong className="text-on-surface">
                    #{task?.id} {task?.title} (Depth {task?.depth}, root)
                  </strong>
                </span>
              )}
            </div>
            <div className="space-y-2">
              {subtasks.map((sub) => (
                <div key={sub.id} className="px-3 py-2 bg-surface-container-lowest rounded border border-subtle flex justify-between items-center text-xs">
                  <span className="text-on-surface">↳ #{sub.id} {sub.title}</span>
                  <span className="text-on-surface-variant font-mono">Depth {sub.depth}</span>
                </div>
              ))}
              {task && task.depth < 2 ? (
                <form onSubmit={handleCreateSubtask} className="flex gap-2 pt-2">
                  <input
                    type="text"
                    placeholder={`Add subtask (${task.depth === 0 ? "1.1" : "1.1.1"})...`}
                    value={newSubtaskTitle}
                    onChange={(e) => setNewSubtaskTitle(e.target.value)}
                    className="flex-1 bg-surface-container-lowest border border-subtle rounded px-3 py-1.5 text-xs text-on-primary"
                  />
                  <button
                    type="submit"
                    className="px-3 py-1.5 bg-primary-container hover:bg-primary rounded text-xs font-semibold text-on-primary transition-colors"
                  >
                    Add Subtask
                  </button>
                </form>
              ) : (
                <div className="text-[11px] text-amber-400">Microtask leaf level reached (max depth 2). Cannot gain children.</div>
              )}
            </div>
          </div>

          {/* Tabs: Comments / Attachments / Audit */}
          <div className="border-t border-subtle pt-4 space-y-4">
            <div className="flex gap-2 border-b border-subtle pb-2">
              {(["comments", "attachments", "audit"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-3 py-1 rounded text-xs font-semibold capitalize transition-colors ${
                    activeTab === tab ? "bg-primary-container text-on-primary" : "text-on-surface-variant hover:text-on-surface bg-surface-container/50"
                  }`}
                >
                  {tab} {tab === "comments" ? `(${comments.length})` : tab === "attachments" ? `(${attachments.length})` : `(${history.length})`}
                </button>
              ))}
            </div>

            {activeTab === "comments" && (
              <div className="space-y-4">
                <div className="space-y-3 max-h-48 overflow-y-auto">
                  {comments
                    .filter((c) => !c.parent_id)
                    .map((c) => (
                      <div key={c.id} className="space-y-2">
                        <div className="p-3 bg-surface rounded border border-subtle text-xs space-y-1">
                          <div className="flex justify-between text-outline font-mono text-[10px]">
                            <span>
                              Author #{c.author_id}
                              {(c.mentions ?? []).length > 0 && (
                                <span className="text-primary"> → @{(c.mentions ?? []).join(", @")}</span>
                              )}
                            </span>
                            <span>{new Date(c.created_at).toLocaleString()}</span>
                          </div>
                          <div className="text-on-surface">{c.body_md}</div>
                          <button
                            onClick={() => setReplyToId(c.id)}
                            className="text-[11px] text-primary hover:text-primary"
                          >
                            Reply
                          </button>
                        </div>
                        {comments
                          .filter((r) => r.parent_id === c.id)
                          .map((r) => (
                            <div
                              key={r.id}
                              className="ml-6 p-2.5 bg-surface-container-lowest rounded border-l-2 border-primary border-y border-r border-subtle text-xs space-y-1"
                            >
                              <div className="flex justify-between text-outline font-mono text-[10px]">
                                <span>
                                  Author #{r.author_id}
                                  {(r.mentions ?? []).length > 0 && (
                                    <span className="text-primary"> → @{(r.mentions ?? []).join(", @")}</span>
                                  )}
                                </span>
                                <span>{new Date(r.created_at).toLocaleString()}</span>
                              </div>
                              <div className="text-on-surface">{r.body_md}</div>
                            </div>
                          ))}
                      </div>
                    ))}
                  {comments.length === 0 && <div className="text-xs text-outline">No comments yet.</div>}
                </div>
                {replyToId && (
                  <div className="text-[11px] text-on-surface-variant">
                    Replying to comment #{replyToId}{" "}
                    <button onClick={() => setReplyToId(null)} className="text-primary hover:text-primary">
                      cancel
                    </button>
                  </div>
                )}
                <form onSubmit={handleAddComment} className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Write a comment (markdown + @userId mentions supported)..."
                    value={commentInput}
                    onChange={(e) => setCommentInput(e.target.value)}
                    className="flex-1 bg-surface border border-subtle rounded px-3 py-2 text-xs text-on-primary"
                  />
                  <button
                    type="submit"
                    className="px-4 py-2 bg-primary-container hover:bg-primary rounded text-xs font-semibold text-on-primary"
                  >
                    Post
                  </button>
                </form>
              </div>
            )}

            {activeTab === "attachments" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-on-surface-variant">Files (10MB limit per file)</span>
                  <label className="px-3 py-1 bg-primary-container hover:bg-primary rounded text-xs font-semibold text-on-primary cursor-pointer">
                    Upload File
                    <input type="file" onChange={handleUploadAttachment} className="hidden" />
                  </label>
                </div>
                <div className="space-y-2 max-h-40 overflow-y-auto">
                  {attachments.map((att) => (
                    <div key={att.id} className="p-2.5 bg-surface rounded border border-subtle flex justify-between items-center text-xs">
                      <div>
                        <span className="text-on-surface font-medium">{att.filename}</span>
                        <span className="text-outline ml-2 font-mono text-[10px]">({Math.round(att.size / 1024)} KB)</span>
                      </div>
                      <button
                        onClick={() => handleDeleteAttachment(att.id)}
                        className="text-rose-400 hover:text-error text-xs"
                      >
                        Delete
                      </button>
                    </div>
                  ))}
                  {attachments.length === 0 && <div className="text-xs text-outline">No attachments uploaded.</div>}
                </div>
              </div>
            )}

            {activeTab === "audit" && (
              <div className="space-y-2 max-h-48 overflow-y-auto text-xs font-mono">
                {history.map((h) => (
                  <div key={h.id} className="p-2 bg-surface rounded border border-subtle flex justify-between text-on-surface-variant">
                    <span>Status change to #{h.to_status_id} (Actor #{h.actor_id || "system"})</span>
                    <span className="text-outline">{new Date(h.at).toLocaleString()}</span>
                  </div>
                ))}
                {history.length === 0 && <div className="text-xs text-outline font-sans">No audit logs recorded.</div>}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-surface border-t border-subtle flex justify-end gap-3 sticky bottom-0 z-10">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded bg-surface-container text-on-surface-variant hover:text-on-surface text-xs font-medium"
          >
            Cancel
          </button>
          <button
            onClick={handleSaveTask}
            className="px-5 py-2 rounded bg-primary-container hover:bg-primary text-on-primary text-xs font-semibold shadow-lg shadow-indigo-600/20"
          >
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}
