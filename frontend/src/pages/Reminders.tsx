import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../stores/auth";
import {
  api,
  displayAnchor,
  fromDueInput,
  repeatLabel,
  toDueInput,
  type Reminder,
} from "../utils/reminders";

interface ProjectOption {
  id: number;
  name: string;
  code: string;
}

interface TaskOption {
  id: number;
  title: string;
}

interface FireInfo {
  notify_user_ids: number[];
  follow_up: { source_project_id: number | null; kind: string; suggested_name: string };
}

const STATUS_TABS = ["active", "done", "dismissed"] as const;

/** My Reminders (tickets 04–06): dated nudges anchored to work items. */
export default function Reminders() {
  const auth = useAuth();
  const [params] = useSearchParams();
  const readOnly = auth.role === "guest";
  const [tab, setTab] = useState<(typeof STATUS_TABS)[number]>("active");
  const [rows, setRows] = useState<Reminder[]>([]);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [fired, setFired] = useState<Record<number, FireInfo>>({});
  const [followUpName, setFollowUpName] = useState<Record<number, string>>({});
  const [followUpDone, setFollowUpDone] = useState<Record<number, { id: number; name: string }>>({});

  // Create form state (anchor prefilled from ?project_id= / ?task_id=).
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [dueTime, setDueTime] = useState("");
  const [anchorKind, setAnchorKind] = useState<"project" | "task">(
    params.get("task_id") ? "task" : "project"
  );
  const [anchorProjectId, setAnchorProjectId] = useState(params.get("project_id") || "");
  const [anchorTaskId, setAnchorTaskId] = useState(params.get("task_id") || "");
  const [repeat, setRepeat] = useState("none");
  const [repeatEnd, setRepeatEnd] = useState("never");
  const [repeatAfterN, setRepeatAfterN] = useState("2");
  const [repeatUntil, setRepeatUntil] = useState("");
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [tasks, setTasks] = useState<TaskOption[]>([]);

  const load = useCallback(async () => {
    if (!auth.accessToken) return;
    try {
      setError("");
      const data = await api<Reminder[]>(auth.accessToken, `/api/v1/reminders/mine?status=${tab}`);
      setRows(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load reminders");
    }
  }, [auth.accessToken, tab]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!auth.accessToken) return;
    api<ProjectOption[]>(auth.accessToken, "/api/v1/projects")
      .then(setProjects)
      .catch(() => setProjects([]));
  }, [auth.accessToken]);

  useEffect(() => {
    if (!auth.accessToken || !anchorProjectId) {
      setTasks([]);
      return;
    }
    api<TaskOption[]>(auth.accessToken, `/api/v1/tasks?project_id=${anchorProjectId}`)
      .then((t) => setTasks(Array.isArray(t) ? t : []))
      .catch(() => setTasks([]));
  }, [auth.accessToken, anchorProjectId]);

  async function act(id: number, path: string, body?: unknown, method = "POST") {
    if (!auth.accessToken) return;
    try {
      setError("");
      await api(auth.accessToken, `/api/v1/reminders/${id}/${path}`, {
        method,
        body: body ? JSON.stringify(body) : undefined,
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    }
  }

  async function create() {
    if (!auth.accessToken || !title.trim() || !dueDate) {
      setError("Title and due date are required");
      return;
    }
    const payload: Record<string, unknown> = {
      title: title.trim(),
      note,
      due_at: fromDueInput(dueDate, dueTime),
      repeat,
      repeat_end: repeatEnd,
    };
    if (repeat !== "none" && repeatEnd === "after") payload.repeat_after_n = Number(repeatAfterN);
    if (repeat !== "none" && repeatEnd === "until") payload.repeat_until = repeatUntil;
    if (anchorKind === "task" && anchorTaskId) payload.task_id = Number(anchorTaskId);
    else if (anchorProjectId) payload.project_id = Number(anchorProjectId);
    else {
      setError("Pick an anchor project (or task)");
      return;
    }
    try {
      setError("");
      await api(auth.accessToken, "/api/v1/reminders", { method: "POST", body: JSON.stringify(payload) });
      setTitle("");
      setNote("");
      setDueDate("");
      setDueTime("");
      setShowCreate(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed");
    }
  }

  async function fireReminder(id: number) {
    if (!auth.accessToken) return;
    try {
      setError("");
      const out = await api<{ reminder: Reminder; notify_user_ids: number[]; follow_up: FireInfo["follow_up"] }>(
        auth.accessToken,
        `/api/v1/reminders/${id}/fire`,
        { method: "POST" }
      );
      setFired((f) => ({ ...f, [id]: { notify_user_ids: out.notify_user_ids, follow_up: out.follow_up } }));
      setFollowUpName((m) => ({ ...m, [id]: m[id] ?? out.follow_up.suggested_name }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fire failed");
    }
  }

  async function createFollowUp(id: number) {
    if (!auth.accessToken) return;
    const name = (followUpName[id] || "").trim();
    if (!name) {
      setError("Follow-up project name is required");
      return;
    }
    try {
      setError("");
      const out = await api<{ project: { id: number; name: string } }>(
        auth.accessToken,
        `/api/v1/reminders/${id}/follow-up-project`,
        { method: "POST", body: JSON.stringify({ name }) }
      );
      setFollowUpDone((m) => ({ ...m, [id]: { id: out.project.id, name: out.project.name } }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Follow-up failed");
    }
  }

  const overdue = rows.filter((r) => r.status === "active" && r.is_overdue);

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-on-surface">My Reminders</h1>
        {!readOnly && (
          <button
            onClick={() => setShowCreate((s) => !s)}
            className="px-4 py-1.5 rounded-lg bg-primary-container text-on-primary text-xs font-semibold hover:bg-primary"
          >
            {showCreate ? "Cancel" : "+ New reminder"}
          </button>
        )}
      </div>

      {error && <div className="p-3 rounded-lg bg-error-container text-error text-xs">{error}</div>}

      {tab === "active" && overdue.length > 0 && (
        <div className="p-3 rounded-lg border border-error bg-error-container text-error text-xs font-semibold">
          {overdue.length} overdue reminder{overdue.length === 1 ? "" : "s"} — {overdue.map((r) => r.title).join(", ")}
        </div>
      )}

      {showCreate && !readOnly && (
        <div className="p-4 rounded-lg border border-subtle bg-surface-container-lowest space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs text-on-surface-variant">
              Title
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="mt-1 w-full text-sm bg-surface-container border border-subtle rounded-lg px-2.5 py-1.5 text-on-surface"
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-xs text-on-surface-variant">
                Due date
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="mt-1 w-full text-sm bg-surface-container border border-subtle rounded-lg px-2.5 py-1.5 text-on-surface"
                />
              </label>
              <label className="block text-xs text-on-surface-variant">
                Time (optional, 09:00 default)
                <input
                  type="time"
                  value={dueTime}
                  onChange={(e) => setDueTime(e.target.value)}
                  className="mt-1 w-full text-sm bg-surface-container border border-subtle rounded-lg px-2.5 py-1.5 text-on-surface"
                />
              </label>
            </div>
          </div>
          <label className="block text-xs text-on-surface-variant">
            Note
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="mt-1 w-full text-sm bg-surface-container border border-subtle rounded-lg px-2.5 py-1.5 text-on-surface"
            />
          </label>
          <div className="grid grid-cols-3 gap-3">
            <label className="block text-xs text-on-surface-variant">
              Anchor
              <select
                value={anchorKind}
                onChange={(e) => setAnchorKind(e.target.value as "project" | "task")}
                className="mt-1 w-full text-sm bg-surface-container border border-subtle rounded-lg px-2 py-1.5 text-on-surface"
              >
                <option value="project">Project</option>
                <option value="task">Task / Subtask / Microtask</option>
              </select>
            </label>
            <label className="block text-xs text-on-surface-variant">
              Project
              <select
                value={anchorProjectId}
                onChange={(e) => setAnchorProjectId(e.target.value)}
                className="mt-1 w-full text-sm bg-surface-container border border-subtle rounded-lg px-2 py-1.5 text-on-surface"
              >
                <option value="">Select project…</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code} — {p.name}
                  </option>
                ))}
              </select>
            </label>
            {anchorKind === "task" && (
              <label className="block text-xs text-on-surface-variant">
                Task
                <select
                  value={anchorTaskId}
                  onChange={(e) => setAnchorTaskId(e.target.value)}
                  className="mt-1 w-full text-sm bg-surface-container border border-subtle rounded-lg px-2 py-1.5 text-on-surface"
                >
                  <option value="">Select task…</option>
                  {tasks.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <div className="grid grid-cols-4 gap-3">
            <label className="block text-xs text-on-surface-variant">
              Repeat
              <select
                value={repeat}
                onChange={(e) => setRepeat(e.target.value)}
                className="mt-1 w-full text-sm bg-surface-container border border-subtle rounded-lg px-2 py-1.5 text-on-surface"
              >
                {["none", "daily", "weekly", "monthly", "yearly"].map((r) => (
                  <option key={r} value={r}>
                    {r === "none" ? "One-time" : r}
                  </option>
                ))}
              </select>
            </label>
            {repeat !== "none" && (
              <>
                <label className="block text-xs text-on-surface-variant">
                  Ends
                  <select
                    value={repeatEnd}
                    onChange={(e) => setRepeatEnd(e.target.value)}
                    className="mt-1 w-full text-sm bg-surface-container border border-subtle rounded-lg px-2 py-1.5 text-on-surface"
                  >
                    <option value="never">Never</option>
                    <option value="after">After N times</option>
                    <option value="until">Until date</option>
                  </select>
                </label>
                {repeatEnd === "after" && (
                  <label className="block text-xs text-on-surface-variant">
                    Times
                    <input
                      type="number"
                      min={1}
                      value={repeatAfterN}
                      onChange={(e) => setRepeatAfterN(e.target.value)}
                      className="mt-1 w-full text-sm bg-surface-container border border-subtle rounded-lg px-2.5 py-1.5 text-on-surface"
                    />
                  </label>
                )}
                {repeatEnd === "until" && (
                  <label className="block text-xs text-on-surface-variant">
                    Until
                    <input
                      type="date"
                      value={repeatUntil}
                      onChange={(e) => setRepeatUntil(e.target.value)}
                      className="mt-1 w-full text-sm bg-surface-container border border-subtle rounded-lg px-2.5 py-1.5 text-on-surface"
                    />
                  </label>
                )}
              </>
            )}
          </div>
          <button
            onClick={() => void create()}
            className="px-4 py-1.5 rounded-lg bg-primary-container text-on-primary text-xs font-semibold hover:bg-primary"
          >
            Create reminder
          </button>
        </div>
      )}

      <div className="flex gap-2 text-xs">
        {STATUS_TABS.map((s) => (
          <button
            key={s}
            onClick={() => setTab(s)}
            className={`px-3 py-1 rounded-lg font-medium capitalize ${
              tab === s ? "bg-primary-container text-on-primary" : "text-on-surface-variant hover:bg-surface-container"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {rows.length === 0 && <div className="text-xs text-on-surface-variant">No {tab} reminders.</div>}
        {rows.map((r) => {
          const fire = fired[r.id];
          const done = followUpDone[r.id];
          const due = toDueInput(r.due_at);
          return (
            <div
              key={r.id}
              className={`p-3 rounded-lg border ${
                r.is_overdue && r.status === "active"
                  ? "border-error bg-error-container/40"
                  : "border-subtle bg-surface-container-lowest"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-on-surface truncate">
                    {r.title}
                    {r.is_overdue && r.status === "active" && (
                      <span className="ml-2 text-[11px] font-bold text-error">OVERDUE</span>
                    )}
                    {r.is_detached && (
                      <span className="ml-2 text-[11px] font-medium text-on-surface-variant">detached</span>
                    )}
                  </div>
                  <div className="text-[11px] text-on-surface-variant">
                    Due {due.date}
                    {due.time ? ` ${due.time}` : ""} · {displayAnchor(r)} · {repeatLabel(r)}
                    {r.occurrence_index > 0 ? ` · #${r.occurrence_index + 1}` : ""}
                    {r.snoozed_until ? ` · snoozed to ${r.snoozed_until.slice(0, 16).replace("T", " ")}` : ""}
                  </div>
                  {r.note && <div className="text-xs text-on-surface mt-1">{r.note}</div>}
                </div>
                {r.status === "active" && !readOnly && (
                  <div className="flex flex-wrap gap-1 shrink-0">
                    <button onClick={() => void act(r.id, "done")} className="px-2 py-1 rounded bg-surface-container text-[11px] font-semibold hover:bg-primary-container hover:text-on-primary" title="Mark done">
                      Done
                    </button>
                    <button onClick={() => void act(r.id, "dismiss")} className="px-2 py-1 rounded bg-surface-container text-[11px] font-semibold hover:bg-surface-container-low" title="Dismiss">
                      Dismiss
                    </button>
                    <button onClick={() => void act(r.id, "snooze", { duration: "1d" })} className="px-2 py-1 rounded bg-surface-container text-[11px]" title="Snooze 1 day">
                      +1d
                    </button>
                    <button onClick={() => void act(r.id, "snooze", { duration: "1w" })} className="px-2 py-1 rounded bg-surface-container text-[11px]" title="Snooze 1 week">
                      +1w
                    </button>
                    <button onClick={() => void fireReminder(r.id)} className="px-2 py-1 rounded bg-surface-container text-[11px]" title="Fire now (notify + follow-up offer)">
                      Fire
                    </button>
                    <button onClick={() => void act(r.id, "", undefined, "DELETE")} className="px-2 py-1 rounded text-[11px] text-error hover:bg-error-container" title="Delete">
                      ✕
                    </button>
                  </div>
                )}
              </div>
              {fire && (
                <div className="mt-2 p-2 rounded bg-surface-container text-[11px] space-y-2">
                  <div>
                    Notifies {fire.notify_user_ids.length} user{fire.notify_user_ids.length === 1 ? "" : "s"} ·{" "}
                    {fire.follow_up.kind} from project {fire.follow_up.source_project_id ?? "—"}
                  </div>
                  {!readOnly && !done && (
                    <div className="flex gap-2">
                      <input
                        value={followUpName[r.id] || ""}
                        onChange={(e) => setFollowUpName((m) => ({ ...m, [r.id]: e.target.value }))}
                        placeholder="Follow-up project name"
                        className="flex-1 text-xs bg-surface-container-lowest border border-subtle rounded px-2 py-1 text-on-surface"
                      />
                      <button
                        onClick={() => void createFollowUp(r.id)}
                        className="px-3 py-1 rounded bg-primary-container text-on-primary text-[11px] font-semibold hover:bg-primary"
                      >
                        Create follow-up Project
                      </button>
                    </div>
                  )}
                  {done && (
                    <div>
                      Created{" "}
                      <Link to={`/projects/${done.id}/list`} className="underline text-primary">
                        {done.name}
                      </Link>{" "}
                      (continues-as) — reminder stays on the original anchor.
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
