import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../stores/auth";
import { useTheme } from "../stores/theme";

interface Category {
  id: number;
  key: string;
  name: string;
  color: string;
  status_profile_id?: number | null;
  project_count?: number;
  profile_name?: string | null;
}

interface Member {
  category_id: number;
  user_id: number;
  role: string;
}

export default function Categories() {
  const auth = useAuth();
  const { theme, setTheme } = useTheme();
  const isSample = theme === "sample";
  const [categories, setCategories] = useState<Category[]>([]);
  const [q, setQ] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState("#6b7280");
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Category | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [memberUserId, setMemberUserId] = useState("");
  const [rename, setRename] = useState("");

  const fetchCategories = () => {
    if (!auth.accessToken) return;
    fetch("/api/v1/categories", {
      headers: { Authorization: `Bearer ${auth.accessToken}` },
    })
      .then((r) => (r.ok ? r.json() : []))
      .then(setCategories)
      .catch(() => setCategories([]));
  };

  useEffect(() => {
    fetchCategories();
  }, [auth.accessToken]);

  const fetchMembers = (id: number) => {
    fetch(`/api/v1/categories/${id}/members`, {
      headers: { Authorization: `Bearer ${auth.accessToken}` },
    })
      .then((r) => (r.ok ? r.json() : []))
      .then(setMembers)
      .catch(() => setMembers([]));
  };

  const handleSelect = (c: Category) => {
    setSelected(c);
    setRename(c.name);
    fetchMembers(c.id);
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    fetch("/api/v1/categories", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth.accessToken}`,
      },
      body: JSON.stringify({ name, color }),
    })
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body.detail || "Failed to create category");
        }
        return r.json();
      })
      .then(() => {
        setName("");
        setColor("#6b7280");
        setShowCreate(false);
        fetchCategories();
      })
      .catch((err) => setError(err.message));
  };

  const handleRename = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected) return;
    setError("");
    fetch(`/api/v1/categories/${selected.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth.accessToken}`,
      },
      body: JSON.stringify({ name: rename }),
    })
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body.detail || "Failed to rename");
        }
        return r.json();
      })
      .then((updated: Category) => {
        setSelected(updated);
        fetchCategories();
      })
      .catch((err) => setError(err.message));
  };

  const handleAddMember = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected || !memberUserId) return;
    fetch(`/api/v1/categories/${selected.id}/members`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth.accessToken}`,
      },
      body: JSON.stringify({ user_id: Number(memberUserId), role: "member" }),
    }).then(() => {
      setMemberUserId("");
      fetchMembers(selected.id);
    });
  };

  const filtered = categories.filter(
    (c) =>
      c.name.toLowerCase().includes(q.toLowerCase()) ||
      c.key.toLowerCase().includes(q.toLowerCase())
  );

  const canCreate = auth.role === "admin" || auth.role === "manager";

  return (
    <main
      className={
        isSample
          ? "p-space-lg bg-surface min-h-screen text-on-surface"
          : "p-6 bg-slate-950 min-h-screen text-slate-100"
      }
    >
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className={isSample ? "text-headline-lg font-headline-lg" : "text-2xl font-semibold"}>
            Categories Directory
          </h1>
          <p className={isSample ? "text-body-sm font-body-sm text-on-surface-variant mt-0.5" : "text-sm text-slate-400 mt-1"}>
            Browse your assigned categories — <Link to="/projects" className="underline">Projects Directory</Link>
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className={isSample ? "text-label-mono font-label-mono text-outline" : "text-xs text-slate-400"}>
            {auth.username} (<span className="capitalize">{auth.role}</span>)
          </div>
          <div className="flex items-center gap-1 text-xs">
            <button
              onClick={() => setTheme("sample")}
              className={`px-2 py-1 rounded ${isSample ? "bg-primary-container text-on-primary-container font-semibold" : "bg-slate-800 text-slate-300"}`}
            >
              Sample
            </button>
            <button
              onClick={() => setTheme("legacy")}
              className={`px-2 py-1 rounded ${!isSample ? "bg-indigo-600 text-white font-semibold" : "bg-surface-container-high text-on-surface-variant"}`}
            >
              Legacy
            </button>
          </div>
          {canCreate && (
            <button
              onClick={() => setShowCreate(!showCreate)}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded font-medium text-sm transition-colors"
            >
              {showCreate ? "Cancel" : "+Add Category"}
            </button>
          )}
        </div>
      </div>

      {showCreate && canCreate && (
        <form onSubmit={handleCreate} className="mb-6 bg-slate-900 p-4 rounded border border-slate-800 max-w-xl">
          <h2 className="text-lg font-medium mb-3">Create New Category</h2>
          {error && <div className="mb-3 text-sm text-rose-400">{error}</div>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Category Name *</label>
              <input
                required
                className="w-full px-3 py-2 rounded bg-slate-800 text-sm border border-slate-700"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Procurements"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Color</label>
              <input
                type="color"
                className="w-full h-10 px-1 py-1 rounded bg-slate-800 text-sm border border-slate-700"
                value={color}
                onChange={(e) => setColor(e.target.value)}
              />
            </div>
          </div>
          <button type="submit" className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded text-sm font-medium text-white">
            Create Category
          </button>
        </form>
      )}

      <div className="mb-4">
        <input
          aria-label="search categories"
          placeholder="Search by name or key..."
          className={
            isSample
              ? "px-space-md py-1 rounded bg-surface-container-lowest border border-subtle w-full max-w-md text-body-sm font-body-sm text-on-surface"
              : "px-3 py-2 rounded bg-slate-900 border border-slate-800 w-full max-w-md text-sm text-slate-200"
          }
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      <div className={isSample ? "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-space-md" : "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"}>
        {filtered.map((c) => (
          <div
            key={c.id}
            onClick={() => handleSelect(c)}
            className={
              isSample
                ? "bg-surface-container-low border border-subtle hover:border-strong rounded p-space-md cursor-pointer transition-all flex flex-col justify-between shadow-sm"
                : "bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-lg p-4 cursor-pointer transition-all flex flex-col justify-between"
            }
          >
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="flex items-center gap-2">
                  <span
                    className="inline-block w-3 h-3 rounded-full"
                    style={{ backgroundColor: c.color }}
                    title={c.color}
                  />
                  <span
                    className={
                      isSample
                        ? "font-label-mono text-label-mono px-space-xs py-0.5 rounded bg-primary-container text-on-primary-container font-semibold"
                        : "font-mono text-xs px-2 py-0.5 rounded bg-indigo-950 text-indigo-300 font-semibold"
                    }
                  >
                    {c.key}
                  </span>
                </span>
                <span className={isSample ? "text-label-mono font-label-mono text-on-surface-variant" : "text-xs text-slate-400"}>
                  Projects: <strong className={isSample ? "text-on-surface" : "text-slate-200"}>{c.project_count ?? 0}</strong>
                </span>
              </div>
              <h2 className={isSample ? "text-title-sm font-title-sm text-on-surface mb-1" : "text-base font-semibold text-slate-100 mb-1"}>{c.name}</h2>
              <p className={isSample ? "text-body-sm font-body-sm text-on-surface-variant" : "text-xs text-slate-400"}>
                Profile: {c.profile_name || "Not set"}
              </p>
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="col-span-full py-12 text-center text-slate-500">
            No categories found.
          </div>
        )}
      </div>

      {selected && (
        <div className="mt-6 bg-slate-900 p-4 rounded border border-slate-800 max-w-2xl">
          <h2 className="text-lg font-medium mb-1">Category: {selected.name}</h2>
          <p className="text-xs text-slate-400 mb-3">Key {selected.key} (immutable — rename preserves key)</p>
          {error && <div className="mb-3 text-sm text-rose-400">{error}</div>}
          {canCreate && (
            <form onSubmit={handleRename} className="flex gap-2 mb-4">
              <input
                aria-label="rename category"
                className="flex-1 px-3 py-2 rounded bg-slate-800 text-sm border border-slate-700"
                value={rename}
                onChange={(e) => setRename(e.target.value)}
              />
              <button type="submit" className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded text-sm font-medium text-white">
                Rename
              </button>
            </form>
          )}
          <h3 className="text-sm font-semibold mb-2">Members</h3>
          <ul className="text-sm text-slate-300 mb-3 space-y-1">
            {members.map((m) => (
              <li key={m.user_id} className="flex items-center justify-between bg-slate-800 px-3 py-1.5 rounded">
                <span>User #{m.user_id} ({m.role})</span>
                {canCreate && (
                  <button
                    onClick={() => {
                      fetch(`/api/v1/categories/${selected.id}/members/${m.user_id}`, {
                        method: "DELETE",
                        headers: { Authorization: `Bearer ${auth.accessToken}` },
                      }).then(() => fetchMembers(selected.id));
                    }}
                    className="text-xs text-rose-400 hover:text-rose-300"
                  >
                    Remove
                  </button>
                )}
              </li>
            ))}
            {members.length === 0 && <li className="text-slate-500">No members yet.</li>}
          </ul>
          {canCreate && (
            <form onSubmit={handleAddMember} className="flex gap-2">
              <input
                aria-label="member user id"
                placeholder="User ID"
                className="w-32 px-3 py-2 rounded bg-slate-800 text-sm border border-slate-700"
                value={memberUserId}
                onChange={(e) => setMemberUserId(e.target.value)}
              />
              <button type="submit" className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded text-sm font-medium text-white">
                Add member
              </button>
            </form>
          )}
        </div>
      )}
    </main>
  );
}
