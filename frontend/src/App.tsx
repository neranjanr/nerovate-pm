import { Suspense, useEffect, useState } from "react";
import { Link, Navigate, Route, Routes, useParams } from "react-router-dom";
import TabBar from "./components/TabBar";
import { REGISTRY } from "./modules/registry";
import Login from "./pages/Login";
import Projects from "./pages/Projects";
import { useAuth } from "./stores/auth";

interface ProjectDetails {
  id: number;
  code: string;
  name: string;
  description: string;
  start_date?: string | null;
  target_date?: string | null;
  task_count?: number;
  owner_name?: string | null;
}

function ProjectShell() {
  const auth = useAuth();
  const { id } = useParams();
  const [project, setProject] = useState<ProjectDetails | null>(null);

  useEffect(() => {
    if (!auth.accessToken || !id) return;
    fetch(`/api/v1/projects/${id}`, {
      headers: { Authorization: `Bearer ${auth.accessToken}` }
    })
      .then((r) => (r.ok ? r.json() : null))
      .then(setProject)
      .catch(() => setProject(null));
  }, [auth.accessToken, id]);

  if (!auth.accessToken || !auth.role) return <Navigate to="/login" replace />;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-4 py-3 bg-slate-900 px-6 border-b border-slate-800">
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <Link to="/projects" className="hover:text-white transition-colors">Projects Directory</Link>
          <span>/</span>
          <span className="text-indigo-300 font-mono font-semibold">{project?.code || "..."}</span>
          <span>/</span>
          <span className="text-slate-100 font-semibold">{project?.name || "Loading..."}</span>
        </div>
        <div className="flex items-center gap-3 text-xs">
          {project?.task_count !== undefined && (
            <div className="px-2.5 py-1 rounded bg-slate-800 text-slate-300">
              Tasks: <span className="font-semibold text-white">{project.task_count}</span>
            </div>
          )}
          {project?.start_date && (
            <div className="px-2.5 py-1 rounded bg-slate-800 text-slate-300">
              Span: <span className="text-white">{project.start_date} {project.target_date ? `to ${project.target_date}` : ""}</span>
            </div>
          )}
          {project?.owner_name && (
            <div className="px-2.5 py-1 rounded bg-slate-800 text-slate-300">
              Owner: <span className="text-white">{project.owner_name}</span>
            </div>
          )}
          <div className="text-slate-400">
            {auth.username} ({auth.role})
          </div>
        </div>
      </div>
      <TabBar role={auth.role} />
      <div className="flex-1">
        <Suspense fallback={<div className="p-6">Loading…</div>}>
          <Routes>
            <Route index element={<Navigate to="timeline" replace />} />
            {REGISTRY.filter((e) => e.requiredRole.includes(auth.role!)).map((e) => (
              <Route key={e.id} path={e.route} element={<e.component />} />
            ))}
          </Routes>
        </Suspense>
      </div>
    </div>
  );
}

export default function App() {
  const auth = useAuth();
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/projects"
        element={auth.accessToken ? <Projects /> : <Navigate to="/login" replace />}
      />
      <Route path="/projects/:id/*" element={<ProjectShell />} />
      <Route path="*" element={<Navigate to={auth.accessToken ? "/projects" : "/login"} replace />} />
    </Routes>
  );
}
