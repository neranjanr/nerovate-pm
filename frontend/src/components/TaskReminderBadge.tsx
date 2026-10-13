import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../stores/auth";
import { api, type Reminder } from "../utils/reminders";

/** Anchor badge (ticket 04): active Reminder count for one task + manage link. */
export default function TaskReminderBadge({ taskId }: { taskId: number }) {
  const auth = useAuth();
  const [rows, setRows] = useState<Reminder[] | null>(null);

  useEffect(() => {
    if (!auth.accessToken) return;
    api<Reminder[]>(auth.accessToken, `/api/v1/reminders?task_id=${taskId}`)
      .then(setRows)
      .catch(() => setRows([]));
  }, [auth.accessToken, taskId]);

  if (rows === null || rows.length === 0) return null;
  const overdue = rows.filter((r) => r.is_overdue).length;
  return (
    <Link
      to={`/reminders?task_id=${taskId}`}
      title={rows.map((r) => r.title).join(", ")}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold ${
        overdue > 0 ? "bg-error-container text-error" : "bg-surface-container text-on-surface-variant hover:text-on-surface"
      }`}
    >
      ⏰ {rows.length} reminder{rows.length === 1 ? "" : "s"}
      {overdue > 0 ? ` · ${overdue} overdue` : ""}
    </Link>
  );
}
