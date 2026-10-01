import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../stores/auth";

interface Project {
  id: number;
  code: string;
  name: string;
  description: string;
}

export default function Projects() {
  const auth = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [q, setQ] = useState("");

  useEffect(() => {
    if (!auth.accessToken) return;
    fetch("/api/v1/projects", {
      headers: { Authorization: `Bearer ${auth.accessToken}` }
    })
      .then((r) => (r.ok ? r.json() : []))
      .then(setProjects)
      .catch(() => setProjects([]));
  }, [auth.accessToken]);

  const filtered = projects.filter(
    (p) =>
      p.name.toLowerCase().includes(q.toLowerCase()) ||
      p.code.toLowerCase().includes(q.toLowerCase())
  );

  return (
    <main className="p-6 bg-slate-950 min-h-screen text-slate-100">
      <h1 className="text-xl font-semibold">Projects Directory</h1>
      <input
        aria-label="search projects"
        placeholder="Search"
        className="mt-3 px-3 py-2 rounded bg-slate-800 w-64"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <ul className="mt-4 flex flex-col gap-2">
        {filtered.map((p) => (
          <li key={p.id} className="bg-slate-900 rounded px-4 py-3">
            <Link to={`/projects/${p.id}/timeline`}>
              <span className="font-mono text-indigo-300">{p.code}</span>{" "}
              <span className="font-medium">{p.name}</span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
