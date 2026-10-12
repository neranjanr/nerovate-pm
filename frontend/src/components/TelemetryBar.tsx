import { useEffect, useState } from "react";
import { useAuth } from "../stores/auth";

function fmtBytes(n: number): string {
  if (!n) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let v = n;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v.toFixed(v >= 10 ? 0 : 1)} ${units[u]}`;
}

/**
 * Telemetry + backup strip (T9 polish). Shared by Timeline and Board so
 * empty/loading/error states and the on-prem backup note look identical.
 * Never blocks the page: failures collapse to a muted note.
 */
export default function TelemetryBar({ projectId }: { projectId: string }) {
  const auth = useAuth();
  const [line, setLine] = useState<string | null>(null);
  const [backup, setBackup] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!auth.accessToken || !projectId) return;
    setLoading(true);
    const h = { Authorization: `Bearer ${auth.accessToken}` };
    Promise.all([
      fetch(`/api/v1/dashboard/summary?project_id=${projectId}`, { headers: h }).then((r) =>
        r.ok ? r.json() : null
      ),
      fetch(`/api/v1/dashboard/storage?project_id=${projectId}`, { headers: h }).then((r) =>
        r.ok ? r.json() : null
      ),
    ])
      .then(([sum, stor]) => {
        if (sum) {
          setLine(
            `Telemetry: ${sum.telemetry?.periods_total ?? 0} periods · ` +
              `${sum.telemetry?.comments_total ?? 0} comments · ` +
              `${sum.telemetry?.attachments_count ?? 0} files · ` +
              `est ${sum.estimate_mins ?? 0}m vs spent ${sum.time_spent_mins ?? 0}m`
          );
        }
        if (stor) {
          setBackup(
            `Backup: DB ${fmtBytes(stor.db_bytes)} + uploads ${fmtBytes(stor.uploads_bytes)} (${stor.uploads_count} files) — ${stor.backup_note}`
          );
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [auth.accessToken, projectId]);

  if (loading) return <div className="text-[11px] text-outline font-mono">Loading telemetry…</div>;
  if (!line && !backup) return <div className="text-[11px] text-outline font-mono">Telemetry unavailable.</div>;
  return (
    <div className="text-[11px] text-outline font-mono flex flex-wrap gap-x-4 gap-y-1">
      {line && <span>{line}</span>}
      {backup && <span>{backup}</span>}
    </div>
  );
}
