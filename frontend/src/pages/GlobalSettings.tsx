import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../stores/auth";

interface StatusInfo {
  id: number;
  profile_id: number;
  stage_id: number | null;
  name: string;
  color: string;
  shade: string | null;
  order: number;
  is_done: boolean;
  is_blocked: boolean;
  is_milestone: boolean;
  active: boolean;
}

interface StageInfo {
  id: number;
  profile_id: number;
  name: string;
  description: string;
  order: number;
  color_base: string;
  active: boolean;
}

interface StatusProfile {
  id: number;
  name: string;
  description: string;
  active: boolean;
  is_template: boolean;
  created_at: string;
  stages: StageInfo[];
  statuses: StatusInfo[];
}

// Q4: 12 distinct Tier-1 colors (names + hex, from status2.html).
const TIER1_PALETTE: { name: string; hex: string }[] = [
  { name: "Indigo", hex: "#4F46E5" },
  { name: "Violet", hex: "#8B5CF6" },
  { name: "Sky", hex: "#0284C7" },
  { name: "Teal", hex: "#0D9488" },
  { name: "Emerald", hex: "#10B981" },
  { name: "Lime", hex: "#84CC16" },
  { name: "Amber", hex: "#F59E0B" },
  { name: "Orange", hex: "#F97316" },
  { name: "Crimson", hex: "#EF4444" },
  { name: "Rose", hex: "#F43F5E" },
  { name: "Fuchsia", hex: "#D946EF" },
  { name: "Slate", hex: "#64748B" },
];

function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  if (Number.isNaN(n)) return [107, 114, 128];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function tintHex(base: string, idx: number, total: number): string {
  const [r, g, b] = hexToRgb(base);
  const t = Math.max(total, 1);
  // Q4 cascade: first leaf lightest (~85% to white), last leaf solid.
  const f = t <= 1 ? 0 : Math.max(0, Math.min(0.85, 0.85 - (idx / (t - 1)) * 0.85));
  const mix = (c: number) => Math.round(c + (255 - c) * f);
  const to = (c: number) => c.toString(16).padStart(2, "0");
  return `#${to(mix(r))}${to(mix(g))}${to(mix(b))}`;
}

/** Q4/Q9: positional shade — cycles every 4 for 5th+ statuses. */
function cascadeShade(base: string, idx: number, total: number): string {
  if (total <= 4) return tintHex(base, idx, total);
  return tintHex(base, idx % 4, 4);
}

function paletteName(hex: string): string {
  return TIER1_PALETTE.find((p) => p.hex.toLowerCase() === hex.toLowerCase())?.name ?? hex;
}

type TabId = "status" | "user" | "backup";

interface MeInfo {
  id: number;
  username: string;
  name: string;
  role: string;
  active: boolean;
}

export default function GlobalSettings() {
  const auth = useAuth();
  const [activeTab, setActiveTab] = useState<TabId>("status");
  const [profiles, setProfiles] = useState<StatusProfile[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [newProfileName, setNewProfileName] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // Tier-1 creator (bottom dashed card, Q3).
  const [newStageName, setNewStageName] = useState("");
  const [newStageColor, setNewStageColor] = useState(TIER1_PALETTE[0].hex);
  const [openPaletteStageId, setOpenPaletteStageId] = useState<number | null>(null);

  // Tier-2 quick-add drafts, keyed by stage id (Q3/Q5).
  const [quickName, setQuickName] = useState<Record<number, string>>({});
  const [quickMilestone, setQuickMilestone] = useState<Record<number, boolean>>({});

  // Profile meta drafts — explicit Save when dirty (name/description/active).
  const [draftProfileName, setDraftProfileName] = useState("");
  const [draftProfileDesc, setDraftProfileDesc] = useState("");
  const [draftProfileActive, setDraftProfileActive] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);

  // Inline Tier-1 edit
  const [editingStageId, setEditingStageId] = useState<number | null>(null);
  const [editingStageName, setEditingStageName] = useState("");
  const [editingStageColor, setEditingStageColor] = useState(TIER1_PALETTE[0].hex);
  // Inline Tier-2 edit (name/stage/done/milestone/active only — color is derived, Q4)
  const [editingStatusId, setEditingStatusId] = useState<number | null>(null);
  const [editingStatusName, setEditingStatusName] = useState("");
  const [editingStatusDone, setEditingStatusDone] = useState(false);
  const [editingStatusMilestone, setEditingStatusMilestone] = useState(false);
  const [editingStatusActive, setEditingStatusActive] = useState(true);
  const [editingStatusStage, setEditingStatusStage] = useState<string>("");
  const [dragStageId, setDragStageId] = useState<number | null>(null);
  const [dragStatusId, setDragStatusId] = useState<number | null>(null);

  // User Profile (self-service) state
  const [me, setMe] = useState<MeInfo | null>(null);
  const [draftName, setDraftName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [savingPw, setSavingPw] = useState(false);

  const canManage = auth.role === "admin" || auth.role === "manager";

  const fetchProfiles = () => {
    if (!auth.accessToken) return;
    fetch("/api/v1/status-profiles", {
      headers: { Authorization: `Bearer ${auth.accessToken}` },
    })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => {
        setProfiles(rows);
        if (rows.length > 0 && selectedId == null) setSelectedId(rows[0].id);
      })
      .catch(() => setProfiles([]));
  };

  useEffect(() => {
    fetchProfiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.accessToken]);

  const fetchMe = () => {
    if (!auth.accessToken) return;
    fetch("/api/v1/auth/me", {
      headers: { Authorization: `Bearer ${auth.accessToken}` },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((row) => {
        if (row) {
          setMe(row);
          setDraftName(row.name ?? "");
        }
      })
      .catch(() => setMe(null));
  };

  useEffect(() => {
    fetchMe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.accessToken]);

  const selectedProfile = profiles.find((p) => p.id === selectedId);
  useEffect(() => {
    setDraftProfileName(selectedProfile?.name ?? "");
    setDraftProfileDesc(selectedProfile?.description ?? "");
    setDraftProfileActive(selectedProfile?.active ?? true);
  }, [selectedProfile?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const sortedStages = useMemo(
    () => [...(selectedProfile?.stages ?? [])].sort((a, b) => a.order - b.order),
    [selectedProfile]
  );

  const statusesByStage = useMemo(() => {
    const map = new Map<number | null, StatusInfo[]>();
    for (const s of selectedProfile?.statuses ?? []) {
      const k = s.stage_id ?? null;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(s);
    }
    for (const arr of map.values()) arr.sort((a, b) => a.order - b.order);
    return map;
  }, [selectedProfile]);

  const authHeaders = () => ({
    "Content-Type": "application/json",
    Authorization: `Bearer ${auth.accessToken}`,
  });

  const createProfile = (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth.accessToken || !newProfileName.trim()) return;
    setError("");
    setNotice("");
    fetch("/api/v1/status-profiles", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ name: newProfileName.trim(), is_template: true }),
    })
      .then(async (r) => {
        if (!r.ok) throw new Error("Create profile failed");
        return r.json();
      })
      .then((created) => {
        setNewProfileName("");
        setNotice("Status Profile created.");
        fetchProfiles();
        setSelectedId(created.id);
      })
      .catch((e) => setError(e.message));
  };

  const isProfileDirty =
    !!selectedProfile &&
    (draftProfileName.trim() !== selectedProfile.name ||
      draftProfileDesc !== (selectedProfile.description ?? "") ||
      draftProfileActive !== selectedProfile.active);

  const revertProfile = () => {
    if (!selectedProfile) return;
    setDraftProfileName(selectedProfile.name);
    setDraftProfileDesc(selectedProfile.description ?? "");
    setDraftProfileActive(selectedProfile.active);
    setError("");
  };

  const saveProfile = () => {
    if (!auth.accessToken || !selectedProfile || !isProfileDirty || savingProfile) return;
    const name = draftProfileName.trim();
    if (!name) {
      setError("Profile name is required.");
      return;
    }
    setError("");
    setSavingProfile(true);
    fetch(`/api/v1/status-profiles/${selectedProfile.id}`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ name, description: draftProfileDesc, active: draftProfileActive }),
    })
      .then(async (r) => {
        if (!r.ok) throw new Error("Save profile failed");
        return r.json();
      })
      .then(() => {
        setNotice("Profile saved.");
        fetchProfiles();
      })
      .catch((e) => setError(e.message))
      .finally(() => setSavingProfile(false));
  };

  const deleteProfile = (id: number) => {
    if (!auth.accessToken || !confirm("Delete this status profile?")) return;
    fetch(`/api/v1/status-profiles/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${auth.accessToken}` },
    }).then(() => {
      setSelectedId(null);
      fetchProfiles();
    });
  };

  const cloneProfile = (id: number) => {
    if (!auth.accessToken) return;
    fetch(`/api/v1/status-profiles/${id}/clone`, {
      method: "POST",
      headers: { Authorization: `Bearer ${auth.accessToken}` },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((res) => {
        if (res) {
          setNotice("Profile cloned.");
          fetchProfiles();
          setSelectedId(res.id);
        }
      });
  };

  // ---- Tier-1 (Stage) ops ----
  const addStage = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!auth.accessToken || !selectedProfile || !newStageName.trim()) return;
    fetch(`/api/v1/status-profiles/${selectedProfile.id}/stages`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        name: newStageName.trim(),
        color_base: newStageColor,
        order: selectedProfile.stages.length + 1,
      }),
    }).then(() => {
      setNewStageName("");
      setNotice(`Tier-1 Stage created with ${paletteName(newStageColor)} cascade.`);
      fetchProfiles();
    });
  };

  const updateStage = (stageId: number, patch: Record<string, unknown>) => {
    if (!auth.accessToken) return;
    fetch(`/api/v1/stages/${stageId}`, { method: "PUT", headers: authHeaders(), body: JSON.stringify(patch) })
      .then(() => {
        setEditingStageId(null);
        setOpenPaletteStageId(null);
        setNotice("Tier-1 Stage updated — Tier-2 shades recascaded.");
        fetchProfiles();
      })
      .catch((e) => setError(e.message));
  };

  const deleteStage = (stageId: number) => {
    if (!auth.accessToken) return;
    fetch(`/api/v1/stages/${stageId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${auth.accessToken}` },
    })
      .then(async (r) => {
        if (!r.ok && r.status !== 204) throw new Error("Delete stage failed (must be empty)");
        fetchProfiles();
      })
      .catch((e) => setError(e.message));
  };

  const moveStageOrder = (stageId: number, direction: "up" | "down") => {
    if (!auth.accessToken || !selectedProfile) return;
    const stages = [...sortedStages];
    const idx = stages.findIndex((s) => s.id === stageId);
    const t = direction === "up" ? idx - 1 : idx + 1;
    if (idx < 0 || t < 0 || t >= stages.length) return;
    const a = stages[idx];
    const b = stages[t];
    Promise.all([
      fetch(`/api/v1/stages/${a.id}`, { method: "PUT", headers: authHeaders(), body: JSON.stringify({ order: b.order }) }),
      fetch(`/api/v1/stages/${b.id}`, { method: "PUT", headers: authHeaders(), body: JSON.stringify({ order: a.order }) }),
    ]).then(() => fetchProfiles());
  };

  const dropStageOnto = (targetId: number) => {
    if (!auth.accessToken || dragStageId == null || dragStageId === targetId) return;
    const reordered = [...sortedStages];
    const from = reordered.findIndex((s) => s.id === dragStageId);
    const to = reordered.findIndex((s) => s.id === targetId);
    if (from < 0 || to < 0) return;
    const [moved] = reordered.splice(from, 1);
    reordered.splice(to, 0, moved);
    Promise.all(
      reordered.map((st, i) =>
        fetch(`/api/v1/stages/${st.id}`, { method: "PUT", headers: authHeaders(), body: JSON.stringify({ order: i + 1 }) })
      )
    ).then(() => {
      setDragStageId(null);
      fetchProfiles();
    });
  };

  // ---- Tier-2 (Status) ops ----
  const addStatusToStage = (stageId: number) => {
    if (!auth.accessToken || !selectedProfile) return;
    const name = (quickName[stageId] ?? "").trim();
    if (!name) {
      setError("Enter a Tier-2 Status name first.");
      return;
    }
    setError("");
    const siblings = statusesByStage.get(stageId) ?? [];
    // POST to stage endpoint so backend derives the cascade shade (Q4).
    fetch(`/api/v1/stages/${stageId}/statuses`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        name,
        is_milestone: quickMilestone[stageId] ?? false,
        order: siblings.length + 1,
      }),
    })
      .then(async (r) => {
        if (!r.ok) throw new Error("Add status failed");
        return r.json();
      })
      .then(() => {
        setQuickName((m) => ({ ...m, [stageId]: "" }));
        setQuickMilestone((m) => ({ ...m, [stageId]: false }));
        fetchProfiles();
      })
      .catch((e) => setError(e.message));
  };

  const updateStatus = (statusId: number, patch: Record<string, unknown>) => {
    if (!auth.accessToken || !selectedProfile) return;
    fetch(`/api/v1/status-profiles/${selectedProfile.id}/statuses/${statusId}`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify(patch),
    }).then(() => {
      setEditingStatusId(null);
      setNotice("Tier-2 Status updated.");
      fetchProfiles();
    });
  };

  const toggleMilestone = (s: StatusInfo) => {
    updateStatus(s.id, { is_milestone: !s.is_milestone });
  };

  const deleteStatus = (statusId: number) => {
    if (!auth.accessToken || !selectedProfile) return;
    if (!confirm("Delete status? If in use, you will be prompted to remap.")) return;
    fetch(`/api/v1/status-profiles/${selectedProfile.id}/statuses/${statusId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${auth.accessToken}` },
    })
      .then(async (r) => {
        if (r.status === 409) {
          const body = await r.json();
          const others = selectedProfile.statuses.filter((x) => x.id !== statusId);
          if (!others.length) {
            alert("Cannot delete last status while tasks use it.");
            return;
          }
          const rep = prompt(
            `In use by ${body.detail.usage_tasks} task(s). Enter replacement ID:\n` +
              others.map((x) => `#${x.id}: ${x.name}`).join("\n")
          );
          if (!rep) return;
          await fetch(
            `/api/v1/status-profiles/${selectedProfile.id}/statuses/${statusId}?replacement_id=${Number(rep.trim())}`,
            { method: "DELETE", headers: { Authorization: `Bearer ${auth.accessToken}` } }
          );
        }
        fetchProfiles();
      })
      .catch((e) => setError(e.message));
  };

  const dropStatusOnto = (targetId: number) => {
    if (!auth.accessToken || !selectedProfile || dragStatusId == null || dragStatusId === targetId) return;
    const sorted = [...selectedProfile.statuses].sort((a, b) => a.order - b.order);
    const dragged = sorted.find((s) => s.id === dragStatusId);
    const target = sorted.find((s) => s.id === targetId);
    if (!dragged || !target) return;
    if ((dragged.stage_id ?? null) !== (target.stage_id ?? null)) {
      setError("Drag is within the same Tier-1 Stage only — use the Stage dropdown to move across stages.");
      setDragStatusId(null);
      return;
    }
    const from = sorted.findIndex((s) => s.id === dragStatusId);
    const to = sorted.findIndex((s) => s.id === targetId);
    const reordered = [...sorted];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(to, 0, moved);
    Promise.all(
      reordered.map((st, i) =>
        fetch(`/api/v1/status-profiles/${selectedProfile.id}/statuses/${st.id}`, {
          method: "PUT",
          headers: authHeaders(),
          body: JSON.stringify({ order: i + 1 }),
        })
      )
    ).then(() => {
      setDragStatusId(null);
      setNotice("Tier-2 Statuses reordered — shades recascaded.");
      fetchProfiles();
    });
  };

  const isMeDirty = !!me && draftName.trim() !== "" && draftName.trim() !== me.name;

  const saveMe = () => {
    if (!auth.accessToken || !me || !isMeDirty || savingName) return;
    setError("");
    setSavingName(true);
    fetch("/api/v1/auth/me", {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ name: draftName.trim() }),
    })
      .then(async (r) => {
        if (!r.ok) throw new Error("Save profile failed");
        return r.json();
      })
      .then((row) => {
        setMe(row);
        setNotice("User profile saved.");
      })
      .catch((e) => setError(e.message))
      .finally(() => setSavingName(false));
  };

  const pwStrength = newPw.length === 0 ? "" : newPw.length < 8 ? "Too short (min 8)" : "OK";

  const savePassword = () => {
    if (!auth.accessToken || savingPw) return;
    setError("");
    if (!curPw) {
      setError("Enter current password.");
      return;
    }
    if (newPw.length < 8) {
      setError("New password must be 8+ chars.");
      return;
    }
    if (newPw !== confirmPw) {
      setError("New passwords do not match.");
      return;
    }
    setSavingPw(true);
    fetch("/api/v1/auth/me/change-password", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ current_password: curPw, new_password: newPw }),
    })
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => null);
          throw new Error(body?.detail ?? "Change password failed");
        }
        return r.json();
      })
      .then(() => {
        setCurPw("");
        setNewPw("");
        setConfirmPw("");
        setNotice("Password updated.");
      })
      .catch((e) => setError(e.message))
      .finally(() => setSavingPw(false));
  };

  const meInitials = (me?.name ?? auth.username ?? "?")
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <main className="p-8 bg-surface min-h-screen text-on-surface max-w-6xl mx-auto">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-on-surface-variant">
        <span>System</span>
        <span>›</span>
        <span className="text-secondary">Global Settings</span>
      </div>
      <h1 className="text-2xl font-bold mt-1 mb-1">Global Settings</h1>
      <p className="text-xs text-on-surface-variant mb-6 max-w-3xl">
        Manage status workflows, your user profile & security, and backups.
      </p>

      <div className="w-full bg-surface-container-lowest rounded-xl p-1.5 shadow-sm mb-6">
        <nav className="flex items-center gap-1 overflow-x-auto" aria-label="Global settings tabs">
          <button
            type="button"
            onClick={() => setActiveTab("status")}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] transition-colors ${
              activeTab === "status" ? "bg-primary-container text-on-primary shadow-sm" : "text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low"
            }`}
          >
            <span aria-hidden>⇄</span>
            <span>Status Profiles</span>
            <span className="ml-1 px-1.5 py-0.5 rounded text-[11px] bg-surface-container text-on-surface-variant">{profiles.length}</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("user")}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] transition-colors ${
              activeTab === "user" ? "bg-primary-container text-on-primary shadow-sm" : "text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low"
            }`}
          >
            <span aria-hidden>◉</span>
            <span>User Profile & Security</span>
            <span className="ml-1 flex h-2 w-2 rounded-full bg-tertiary-fixed-dim" title="self-service" />
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("backup")}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] transition-colors ${
              activeTab === "backup" ? "bg-primary-container text-on-primary shadow-sm" : "text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low"
            }`}
          >
            <span aria-hidden>☁</span>
            <span>Backup Settings</span>
            <span className="ml-1 px-1.5 py-0.5 rounded text-[10px] bg-surface-container text-secondary font-semibold">Draft</span>
          </button>
        </nav>
      </div>

      {error && <div className="mb-4 text-xs text-error">{error}</div>}
      {notice && <div className="mb-4 text-xs text-emerald-700">{notice}</div>}

      {activeTab === "user" && (
        <div className="flex flex-col gap-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-7 p-6 rounded-xl bg-surface-container-lowest shadow-sm border border-subtle flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between pb-4">
                  <h3 className="text-[15px] font-semibold">Identity & Organization</h3>
                  {me && <span className="px-2 py-0.5 rounded text-[11px] bg-surface-container text-on-surface-variant">ID: USR-{me.id}</span>}
                </div>
                <div className="flex items-center gap-4 p-4 rounded-lg bg-surface-container-low mb-6">
                  <div className="w-16 h-16 rounded-xl bg-primary-container text-on-primary flex items-center justify-center text-lg font-semibold">
                    {meInitials}
                  </div>
                  <div className="flex flex-col min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[14px] font-semibold">{me?.name ?? "…"}</span>
                      {me && <span className="px-2 py-0.5 rounded text-[11px] bg-secondary text-on-secondary font-semibold">{me.role}</span>}
                    </div>
                    <span className="text-xs text-on-surface-variant">Self-service profile — User Administration (admin) comes later as a separate tab.</span>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-on-surface-variant">Full Name (display name)</label>
                    <input
                      aria-label="full name"
                      value={draftName}
                      onChange={(e) => setDraftName(e.target.value)}
                      className="h-9 px-3 rounded-lg bg-surface-container-low text-on-surface text-[13px] border border-subtle focus:outline-none focus:ring-1 focus:ring-secondary"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-on-surface-variant">Username / Handle (immutable)</label>
                    <input value={me ? `@${me.username}` : ""} readOnly className="h-9 px-3 rounded-lg bg-surface-container text-on-surface-variant text-[13px] border border-subtle" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-on-surface-variant">Work Email</label>
                    <input disabled placeholder="Coming soon — not stored yet" className="h-9 px-3 rounded-lg bg-surface-container text-on-surface-variant text-[13px] border border-subtle opacity-60" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-on-surface-variant">Mobile</label>
                    <input disabled placeholder="Coming soon — not stored yet" className="h-9 px-3 rounded-lg bg-surface-container text-on-surface-variant text-[13px] border border-subtle opacity-60" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-on-surface-variant">Role (read-only)</label>
                    <input value={me?.role ?? ""} readOnly className="h-9 px-3 rounded-lg bg-surface-container text-on-surface-variant text-[13px] border border-subtle" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-on-surface-variant">Department</label>
                    <input disabled placeholder="Coming soon" className="h-9 px-3 rounded-lg bg-surface-container text-on-surface-variant text-[13px] border border-subtle opacity-60" />
                  </div>
                </div>
              </div>
              <div className="pt-6 flex items-center justify-between text-xs text-on-surface-variant">
                <span>{me && !me.active ? "Account inactive — contact admin." : "Edits your own display name only."}</span>
                <button
                  onClick={saveMe}
                  disabled={!isMeDirty || savingName}
                  className="px-4 py-1.5 rounded-lg bg-surface-container-low hover:bg-surface-container text-on-surface text-[13px] disabled:opacity-50"
                >
                  {savingName ? "Saving…" : "Update Identity"}
                </button>
              </div>
            </div>

            <div className="lg:col-span-5 p-6 rounded-xl bg-surface-container-lowest shadow-sm border border-subtle flex flex-col justify-between">
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-[15px] font-semibold">Password</h3>
                  <span className="px-2 py-0.5 rounded text-[11px] bg-surface-container text-on-surface-variant">Min 8 chars</span>
                </div>
                <p className="text-xs text-on-surface-variant">Change your own password. Current password is verified.</p>
                <div className="flex flex-col gap-3 pt-1">
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-on-surface-variant">Current Password</label>
                    <input type="password" value={curPw} onChange={(e) => setCurPw(e.target.value)} className="h-9 px-3 rounded-lg bg-surface-container-low text-on-surface text-[13px] border border-subtle" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-on-surface-variant">New Password</label>
                    <input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="8+ characters" className="h-9 px-3 rounded-lg bg-surface-container-low text-on-surface text-[13px] border border-subtle" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-on-surface-variant">Confirm New Password</label>
                    <input type="password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} className="h-9 px-3 rounded-lg bg-surface-container-low text-on-surface text-[13px] border border-subtle" />
                  </div>
                  {newPw && <div className="text-[11px] text-on-surface-variant">Strength: {pwStrength}</div>}
                </div>
              </div>
              <div className="pt-6 flex items-center justify-end">
                <button onClick={savePassword} disabled={savingPw} className="h-9 px-4 rounded-lg bg-primary-container text-on-primary text-[13px] disabled:opacity-50">
                  {savingPw ? "Saving…" : "Update Password"}
                </button>
              </div>
            </div>
          </div>

          <div className="p-6 rounded-xl bg-surface-container-lowest shadow-sm border border-subtle flex flex-col gap-4">
            <div>
              <h3 className="text-[15px] font-semibold">Single Sign-On (SSO) & Federated Identity</h3>
              <p className="text-xs text-on-surface-variant">Coming soon — placeholders only, no providers connected yet.</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 rounded-xl bg-surface-container-low border border-subtle opacity-70">
                <div className="flex items-center justify-between">
                  <h4 className="text-[13px] font-semibold">Google Workspace Enterprise</h4>
                  <span className="px-2 py-0.5 rounded text-[11px] bg-surface-container text-on-surface-variant font-semibold">Coming soon</span>
                </div>
                <div className="mt-2 text-xs text-on-surface-variant">OAuth 2.0 / OpenID Connect — not configured.</div>
                <div className="mt-3 flex gap-2">
                  <button disabled className="px-4 py-1.5 rounded-lg bg-surface-container text-on-surface-variant text-xs opacity-60">Re-authenticate</button>
                  <button disabled className="px-4 py-1.5 rounded-lg bg-surface-container text-on-surface-variant text-xs opacity-60">Disconnect</button>
                </div>
              </div>
              <div className="p-4 rounded-xl bg-surface-container-low border border-subtle opacity-70">
                <div className="flex items-center justify-between">
                  <h4 className="text-[13px] font-semibold">Okta Enterprise SSO (SAML 2.0)</h4>
                  <span className="px-2 py-0.5 rounded text-[11px] bg-surface-container text-on-surface-variant font-semibold">Coming soon</span>
                </div>
                <div className="mt-2 text-xs text-on-surface-variant font-mono truncate">IdP Entity: sso.neravate.internal (placeholder)</div>
                <div className="mt-3">
                  <button disabled className="px-4 py-1.5 rounded-lg bg-surface-container text-on-surface-variant text-xs opacity-60">Configure SAML</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === "backup" && (
        <div className="flex flex-col gap-6">
          <div className="p-6 rounded-xl bg-surface-container-lowest shadow-sm border border-subtle flex flex-col gap-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-lg bg-surface-container-low">
              <div>
                <h3 className="text-[15px] font-semibold">Automated Backup Schedules & Cloud Storage</h3>
                <p className="text-xs text-on-surface-variant">Draft / Configuration Mode — preview only, no API yet.</p>
              </div>
              <span className="px-2.5 py-1 rounded text-[12px] bg-surface-container text-secondary font-semibold">Status: Draft</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="p-4 rounded-xl bg-surface-container-low border border-subtle">
                <div className="text-[11px] uppercase tracking-wider text-on-surface-variant">Primary Database Engine</div>
                <div className="text-[15px] font-semibold mt-1">SQLite 3 (WAL Mode)</div>
                <p className="text-xs text-on-surface-variant mt-1">Nightly sqlite3 .backup + tar of /data (planned).</p>
              </div>
              <div className="p-4 rounded-xl bg-surface-container-low border border-subtle">
                <div className="text-[11px] uppercase tracking-wider text-on-surface-variant">Cold Storage Destination</div>
                <div className="text-[15px] font-semibold mt-1">S3 / Zurich Region (planned)</div>
                <p className="text-xs text-on-surface-variant mt-1">Encrypted AES-256-GCM (planned).</p>
              </div>
              <div className="p-4 rounded-xl bg-surface-container-low border border-subtle">
                <div className="text-[11px] uppercase tracking-wider text-on-surface-variant">Retention & Cadence</div>
                <div className="text-[15px] font-semibold mt-1">30-Day Rolling (planned)</div>
                <p className="text-xs text-on-surface-variant mt-1">Nightly snapshot at 02:00 UTC (planned).</p>
              </div>
            </div>
            <div className="flex flex-col gap-2 pt-2">
              <div className="flex items-center justify-between">
                <span className="text-[14px] font-semibold">Recent Snapshots (preview)</span>
                <button disabled title="Coming soon" className="px-4 py-1 rounded bg-secondary text-on-secondary text-xs opacity-50">Trigger Manual Backup</button>
              </div>
              <div className="overflow-x-auto rounded-lg bg-surface-container-low p-2 border border-subtle">
                <table className="w-full text-left text-xs">
                  <thead className="text-on-surface-variant border-b border-surface-container">
                    <tr>
                      <th className="py-2 px-3">Snapshot File</th>
                      <th className="py-2 px-3">Timestamp</th>
                      <th className="py-2 px-3">Size</th>
                      <th className="py-2 px-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-surface-container">
                      <td className="py-2.5 px-3 font-mono">neravate_db_20250518_0200.sqlite.zst (example)</td>
                      <td className="py-2.5 px-3 text-on-surface-variant">Today at 02:00 UTC (example)</td>
                      <td className="py-2.5 px-3 font-mono">—</td>
                      <td className="py-2.5 px-3 text-right"><button disabled className="text-secondary opacity-50">Download</button></td>
                    </tr>
                    <tr>
                      <td className="py-2.5 px-3 font-mono">neravate_db_20250517_0200.sqlite.zst (example)</td>
                      <td className="py-2.5 px-3 text-on-surface-variant">Yesterday at 02:00 UTC (example)</td>
                      <td className="py-2.5 px-3 font-mono">—</td>
                      <td className="py-2.5 px-3 text-right"><button disabled className="text-secondary opacity-50">Download</button></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === "status" && (
      <>
      <p className="text-xs text-on-surface-variant mb-4">
        Tier 1: Stage · Tier 2: leaf Status. Tier-1 color cascades to Tier-2 shades automatically. ★ = Milestone.
      </p>
      {!canManage && <div className="mb-4 p-3 border rounded text-sm">Read-only for role ({auth.role}).</div>}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-surface-container-lowest border border-subtle rounded-lg p-4 flex flex-col h-[70vh]">
          <h2 className="text-sm font-semibold mb-3">Profiles ({profiles.length})</h2>
          <div className="flex-1 overflow-y-auto space-y-2 pr-1">
            {profiles.map((p) => (
              <div
                key={p.id}
                onClick={() => setSelectedId(p.id)}
                className={`p-3 rounded-lg cursor-pointer border flex items-center justify-between ${
                  selectedId === p.id ? "bg-primary-fixed/60 border-primary" : "bg-surface border-subtle"
                }`}
              >
                <div>
                  <div className="font-medium text-sm">
                    #{p.id} {p.name} {!p.active && <span className="text-[10px] text-outline">(inactive)</span>}
                  </div>
                  <div className="text-[11px] text-on-surface-variant mt-0.5">
                    {p.stages.length} Tier-1 · {p.statuses.length} Tier-2 · {p.statuses.filter((s) => s.is_milestone).length} ★
                  </div>
                </div>
              </div>
            ))}
          </div>
          {canManage && (
            <form onSubmit={createProfile} className="mt-4 pt-3 border-t border-subtle flex gap-2">
              <input
                placeholder="New profile name..."
                value={newProfileName}
                onChange={(e) => setNewProfileName(e.target.value)}
                className="flex-1 px-2.5 py-1.5 rounded bg-surface border border-subtle text-xs"
              />
              <button type="submit" className="px-3 py-1.5 rounded bg-primary-container text-on-primary text-xs">
                + Add
              </button>
            </form>
          )}
        </div>

        <div className="md:col-span-2 bg-surface-container-lowest border border-subtle rounded-lg p-5 flex flex-col h-[70vh] overflow-y-auto">
          {selectedProfile ? (
            <div>
              <div className="flex items-center justify-between pb-4 border-b border-subtle flex-wrap gap-2">
                <div className="flex-1 min-w-52">
                  <div className="text-[11px] uppercase text-on-surface-variant">Profile #{selectedProfile.id}</div>
                  {canManage ? (
                    <input
                      aria-label="profile name"
                      value={draftProfileName}
                      onChange={(e) => setDraftProfileName(e.target.value)}
                      className="mt-0.5 w-full px-2 py-1 rounded bg-surface border border-subtle text-lg font-semibold"
                    />
                  ) : (
                    <h2 className="text-lg font-semibold">#{selectedProfile.id} {selectedProfile.name}</h2>
                  )}
                  <input
                    aria-label="profile description"
                    placeholder="Lifecycle scope / description..."
                    value={canManage ? draftProfileDesc : (selectedProfile.description ?? "")}
                    onChange={(e) => canManage && setDraftProfileDesc(e.target.value)}
                    readOnly={!canManage}
                    className="mt-1 w-full px-2 py-1 rounded bg-surface border border-subtle text-xs"
                  />
                  {canManage && isProfileDirty && (
                    <div className="mt-1.5 flex items-center gap-2">
                      <button
                        onClick={saveProfile}
                        disabled={savingProfile}
                        className="px-4 py-1.5 rounded bg-primary-container text-on-primary text-xs font-semibold disabled:opacity-50"
                      >
                        {savingProfile ? "Saving…" : "Save Profile"}
                      </button>
                      <button onClick={revertProfile} className="px-3 py-1.5 rounded text-xs text-on-surface-variant">
                        Revert
                      </button>
                      <span className="text-[11px] text-on-surface-variant">Unsaved changes</span>
                    </div>
                  )}
                </div>
                {canManage && (
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-1 text-xs">
                      <input type="checkbox" checked={draftProfileActive} onChange={(e) => setDraftProfileActive(e.target.checked)} /> Active
                    </label>
                    <button onClick={() => cloneProfile(selectedProfile.id)} className="px-3 py-1.5 rounded bg-surface-container border border-subtle text-xs">
                      Clone
                    </button>
                    <button onClick={() => deleteProfile(selectedProfile.id)} className="px-3 py-1.5 rounded text-xs text-error">
                      Delete
                    </button>
                  </div>
                )}
              </div>

              <div className="mt-3 p-3 rounded-lg bg-surface border border-subtle text-[11px]">
                <strong>Color cascade:</strong> Tier-1 color → Tier-2 auto shades (light tint → solid). Tier-2 color is
                read-only; recolor Tier-1 to recascade. 5th+ statuses cycle the 4-shade ramp.
              </div>

              {/* Tier-1 stages with nested Tier-2 */}
              <div className="mt-4 space-y-3">
                {sortedStages.map((st, stageIdx) => {
                  const kids = statusesByStage.get(st.id) ?? [];
                  const preview = [0, 1, 2, 3].map((i) => cascadeShade(st.color_base, i, 4));
                  return (
                    <div key={st.id} className="border border-subtle rounded-lg overflow-hidden">
                      <div
                        draggable={canManage}
                        onDragStart={() => setDragStageId(st.id)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={() => dropStageOnto(st.id)}
                        className="p-2.5 bg-surface flex items-center justify-between gap-2 flex-wrap"
                      >
                        <div className="flex items-center gap-2 flex-1 flex-wrap">
                          <span className="cursor-grab text-outline" title="Drag Tier-1 to reorder">⠿</span>
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-surface-container">
                            T1 · {String(stageIdx + 1).padStart(2, "0")}
                          </span>
                          {editingStageId === st.id ? (
                            <>
                              <input
                                aria-label="edit stage name"
                                value={editingStageName}
                                onChange={(e) => setEditingStageName(e.target.value)}
                                className="px-2 py-1 rounded border border-subtle text-xs w-40"
                              />
                              <div className="flex items-center gap-1">
                                {TIER1_PALETTE.map((c) => (
                                  <button
                                    type="button"
                                    key={c.hex}
                                    title={c.name}
                                    onClick={() => setEditingStageColor(c.hex)}
                                    className={`w-5 h-5 rounded-full border ${editingStageColor === c.hex ? "ring-2 ring-primary" : ""}`}
                                    style={{ backgroundColor: c.hex }}
                                  />
                                ))}
                              </div>
                              <button
                                onClick={() => updateStage(st.id, { name: editingStageName.trim() || st.name, color_base: editingStageColor })}
                                className="px-2 py-1 rounded bg-primary-container text-on-primary text-[11px]"
                              >
                                Save
                              </button>
                              <button onClick={() => setEditingStageId(null)} className="px-2 py-1 rounded text-[11px]">
                                Cancel
                              </button>
                            </>
                          ) : (
                            <>
                              <div className="relative">
                                <button
                                  title={`Tier-1 color: ${paletteName(st.color_base)} — click to change`}
                                  onClick={() => setOpenPaletteStageId(openPaletteStageId === st.id ? null : st.id)}
                                  className="flex items-center gap-1.5 px-2 py-1 rounded border border-subtle text-[11px]"
                                >
                                  <span className="w-4 h-4 rounded-full" style={{ backgroundColor: st.color_base }} />
                                  {paletteName(st.color_base)} ▾
                                </button>
                                {openPaletteStageId === st.id && canManage && (
                                  <div className="absolute left-0 top-9 z-20 w-64 p-2 bg-surface-container-lowest border border-subtle rounded-lg shadow-xl">
                                    <div className="text-[10px] uppercase mb-1">12-color Tier-1 palette</div>
                                    <div className="grid grid-cols-4 gap-1.5">
                                      {TIER1_PALETTE.map((c) => (
                                        <button
                                          key={c.hex}
                                          title={`${c.name} ${c.hex}`}
                                          onClick={() => updateStage(st.id, { color_base: c.hex })}
                                          className={`p-1 rounded flex flex-col items-center gap-0.5 ${st.color_base === c.hex ? "ring-2 ring-primary" : ""}`}
                                        >
                                          <span className="w-6 h-6 rounded-full" style={{ backgroundColor: c.hex }} />
                                          <span className="text-[9px]">{c.name}</span>
                                        </button>
                                      ))}
                                    </div>
                                    <div className="mt-2 flex gap-1">
                                      {preview.map((p, i) => (
                                        <span key={i} className="flex-1 py-0.5 rounded text-[9px] text-center text-white" style={{ backgroundColor: p }}>
                                          {["15%", "30%", "50%", "100%"][i]}
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                              <span className="font-semibold text-sm">{st.name}</span>
                              {!st.active && <span className="text-[10px] text-outline">(inactive)</span>}
                              <span className="text-[10px] px-1.5 py-0.5 rounded border border-subtle">
                                {kids.length} Tier-2 · {kids.filter((k) => k.is_milestone).length} ★
                              </span>
                              {canManage && (
                                <button
                                  onClick={() => {
                                    setEditingStageId(st.id);
                                    setEditingStageName(st.name);
                                    setEditingStageColor(st.color_base);
                                  }}
                                  className="px-2 py-0.5 rounded bg-surface-container text-[11px]"
                                >
                                  Rename
                                </button>
                              )}
                            </>
                          )}
                        </div>
                        {canManage && editingStageId !== st.id && (
                          <div className="flex items-center gap-1">
                            <label className="flex items-center gap-1 text-[11px] mr-1">
                              <input
                                type="checkbox"
                                checked={st.active}
                                onChange={() => updateStage(st.id, { active: !st.active })}
                              />
                              Active
                            </label>
                            <button onClick={() => moveStageOrder(st.id, "up")} disabled={stageIdx === 0} className="px-1.5 py-1 rounded text-[11px] disabled:opacity-30">▲</button>
                            <button onClick={() => moveStageOrder(st.id, "down")} disabled={stageIdx === sortedStages.length - 1} className="px-1.5 py-1 rounded text-[11px] disabled:opacity-30">▼</button>
                            <button onClick={() => deleteStage(st.id)} className="px-2 py-1 rounded text-error text-[11px]">Remove</button>
                          </div>
                        )}
                      </div>

                      {/* Tier-2 rows */}
                      <div className="p-2 pl-6 space-y-1.5">
                        {kids.map((s, i) => {
                          const shade = cascadeShade(st.color_base, kids.length > 4 ? i % 4 : i, Math.min(kids.length, 4) || 1);
                          return (
                            <div
                              key={s.id}
                              draggable={canManage && editingStatusId !== s.id}
                              onDragStart={() => setDragStatusId(s.id)}
                              onDragOver={(e) => e.preventDefault()}
                              onDrop={() => dropStatusOnto(s.id)}
                              className="flex items-center justify-between border border-subtle rounded p-2 text-xs gap-2 flex-wrap"
                            >
                              <div className="flex items-center gap-2 flex-1 flex-wrap">
                                <span className="cursor-grab text-outline">⠿</span>
                                <span
                                  title={`Auto shade ${i + 1} of ${paletteName(st.color_base)} cascade (read-only)`}
                                  className="px-1.5 py-0.5 rounded text-[10px] font-mono border border-subtle"
                                  style={{ backgroundColor: shade, color: i >= 2 ? "#fff" : "#111" }}
                                >
                                  Auto {i + 1}
                                </span>
                                {editingStatusId === s.id ? (
                                  <>
                                    <input
                                      aria-label="edit status name"
                                      value={editingStatusName}
                                      onChange={(e) => setEditingStatusName(e.target.value)}
                                      className="px-2 py-1 rounded border border-subtle text-xs w-36"
                                    />
                                    <select
                                      aria-label="edit status stage"
                                      value={editingStatusStage}
                                      onChange={(e) => setEditingStatusStage(e.target.value)}
                                      className="px-2 py-1 rounded border border-subtle text-xs"
                                    >
                                      {sortedStages.map((t) => (
                                        <option key={t.id} value={String(t.id)}>{t.name}</option>
                                      ))}
                                    </select>
                                    <label className="flex items-center gap-1 text-[11px]">
                                      <input type="checkbox" checked={editingStatusDone} onChange={(e) => setEditingStatusDone(e.target.checked)} /> Done
                                    </label>
                                    <label className="flex items-center gap-1 text-[11px]">
                                      <input type="checkbox" checked={editingStatusMilestone} onChange={(e) => setEditingStatusMilestone(e.target.checked)} /> ★ Milestone
                                    </label>
                                    <label className="flex items-center gap-1 text-[11px]">
                                      <input type="checkbox" checked={editingStatusActive} onChange={(e) => setEditingStatusActive(e.target.checked)} /> Active
                                    </label>
                                    <button
                                      onClick={() =>
                                        updateStatus(s.id, {
                                          name: editingStatusName.trim() || s.name,
                                          is_done: editingStatusDone,
                                          is_milestone: editingStatusMilestone,
                                          active: editingStatusActive,
                                          stage_id: editingStatusStage ? Number(editingStatusStage) : s.stage_id,
                                        })
                                      }
                                      className="px-2 py-1 rounded bg-primary-container text-on-primary text-[11px]"
                                    >
                                      Save
                                    </button>
                                    <button onClick={() => setEditingStatusId(null)} className="px-2 py-1 rounded text-[11px]">Cancel</button>
                                  </>
                                ) : (
                                  <>
                                    <span className="font-semibold">{s.name}</span>
                                    {!s.active && <span className="text-[10px] text-outline">(inactive)</span>}
                                    {s.is_done && <span className="px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-300 text-[10px]">Done</span>}
                                    {s.is_milestone && <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300 text-[10px]">★ Milestone</span>}
                                    {canManage && (
                                      <button
                                        onClick={() => {
                                          setEditingStatusId(s.id);
                                          setEditingStatusName(s.name);
                                          setEditingStatusDone(s.is_done);
                                          setEditingStatusMilestone(s.is_milestone);
                                          setEditingStatusActive(s.active);
                                          setEditingStatusStage(s.stage_id ? String(s.stage_id) : "");
                                        }}
                                        className="px-2 py-0.5 rounded bg-surface-container text-[11px]"
                                      >
                                        Edit
                                      </button>
                                    )}
                                  </>
                                )}
                              </div>
                              <div className="flex items-center gap-1">
                                <button
                                  title={s.is_milestone ? "Unmark milestone" : "Mark as milestone"}
                                  onClick={() => canManage && toggleMilestone(s)}
                                  className={`px-2 py-0.5 rounded text-[11px] border ${s.is_milestone ? "bg-amber-100 text-amber-900 border-amber-300" : "text-on-surface-variant"}`}
                                >
                                  ★
                                </button>
                                {canManage && editingStatusId !== s.id && (
                                  <button onClick={() => deleteStatus(s.id)} className="px-2 py-1 rounded text-error text-[11px]">Delete</button>
                                )}
                              </div>
                            </div>
                          );
                        })}

                        {/* Inline Tier-2 quick-add (Q3) */}
                        {canManage && (
                          <div className="flex items-center gap-2 pt-1 flex-wrap">
                            <span className="text-[11px] font-semibold">+ Quick Add Tier-2:</span>
                            <input
                              placeholder="e.g. Budget Approval Sign-off"
                              value={quickName[st.id] ?? ""}
                              onChange={(e) => setQuickName((m) => ({ ...m, [st.id]: e.target.value }))}
                              onKeyDown={(e) => e.key === "Enter" && addStatusToStage(st.id)}
                              className="flex-1 min-w-40 px-2 py-1.5 rounded border border-subtle text-xs"
                            />
                            <label className="flex items-center gap-1 text-[11px]">
                              <input
                                type="checkbox"
                                checked={quickMilestone[st.id] ?? false}
                                onChange={(e) => setQuickMilestone((m) => ({ ...m, [st.id]: e.target.checked }))}
                              />
                              Is Milestone (★)
                            </label>
                            <span className="px-1.5 py-0.5 rounded border border-subtle text-[10px]">Auto Shade</span>
                            <button onClick={() => addStatusToStage(st.id)} className="px-3 py-1.5 rounded bg-primary-container text-on-primary text-xs">
                              + Add Status (Tier 2)
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Bottom Tier-1 creator card (Q3) */}
              {canManage && (
                <form onSubmit={addStage} className="mt-4 p-4 rounded-xl border-2 border-dashed border-subtle space-y-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <h3 className="text-sm font-semibold">+ Add Lifecycle Stage (Tier 1)</h3>
                    <span className="text-[11px] text-on-surface-variant">Stage forms the primary container for status sequence</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      placeholder="e.g. Implementation & Testing"
                      value={newStageName}
                      onChange={(e) => setNewStageName(e.target.value)}
                      className="flex-1 min-w-52 px-3 py-2 rounded border border-subtle text-sm"
                    />
                    <span className="text-xs">Stage Color:</span>
                    <div className="flex items-center gap-1.5">
                      {TIER1_PALETTE.map((c) => (
                        <button
                          type="button"
                          key={c.hex}
                          title={`${c.name} ${c.hex}`}
                          onClick={() => setNewStageColor(c.hex)}
                          className={`w-6 h-6 rounded-full ${newStageColor === c.hex ? "ring-2 ring-primary" : ""}`}
                          style={{ backgroundColor: c.hex }}
                        />
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-1 text-[10px]">
                      <span className="uppercase font-semibold mr-1">Preview:</span>
                      {[0, 1, 2, 3].map((i) => {
                        const p = cascadeShade(newStageColor, i, 4);
                        return (
                          <span key={i} className="px-2 py-0.5 rounded border border-subtle" style={{ backgroundColor: p, color: i >= 2 ? "#fff" : "#111" }}>
                            {["15%", "30%", "50%", "100%"][i]}
                          </span>
                        );
                      })}
                      <span className="ml-1">{paletteName(newStageColor)}</span>
                    </div>
                    <button type="submit" className="px-4 py-2 rounded bg-primary-container text-on-primary text-sm">
                      + Create Stage
                    </button>
                  </div>
                </form>
              )}
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-sm">Select or create a Status Profile.</div>
          )}
        </div>
      </div>
      </>
      )}
    </main>
  );
}
