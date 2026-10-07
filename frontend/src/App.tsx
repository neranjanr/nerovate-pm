import { Suspense, useEffect, useState } from "react";
import { Link, Navigate, Route, Routes, useParams } from "react-router-dom";
import TabBar from "./components/TabBar";
import { REGISTRY } from "./modules/registry";
import Login from "./pages/Login";
import Categories from "./pages/Categories";
import Projects from "./pages/Projects";
import LinkedProjects from "./components/LinkedProjects";
import { useAuth } from "./stores/auth";
import { useTheme, type VisualTheme } from "./stores/theme";

interface ProjectDetails {
  id: number;
  code: string;
  name: string;
  category_id?: number | null;
  category_name?: string | null;
  description: string;
  start_date?: string | null;
  target_date?: string | null;
  task_count?: number;
  owner_name?: string | null;
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const opts: VisualTheme[] = ["sample", "legacy"];
  return (
    <div
      className="flex items-center rounded p-0.5 border border-slate-700 bg-slate-800"
      title="Visual theme (design tokens only)"
    >
      {opts.map((o) => (
        <button
          key={o}
          onClick={() => setTheme(o)}
          className={`px-2.5 py-1 rounded text-xs font-medium capitalize transition-colors ${
            theme === o ? "bg-indigo-600 text-white" : "text-slate-300 hover:text-white"
          }`}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

function ProjectShell() {
  const auth = useAuth();
  const { theme } = useTheme();
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

  const isSample = theme === "sample";

  return (
    <div
      className={
        isSample
          ? "min-h-screen bg-surface text-on-surface flex flex-col"
          : "min-h-screen bg-slate-950 text-slate-100 flex flex-col"
      }
    >
      <div
        className={
          isSample
            ? "flex flex-wrap items-center justify-between gap-space-md py-space-sm bg-surface-container-lowest px-space-xl border-b border-subtle"
            : "flex flex-wrap items-center justify-between gap-4 py-3 bg-slate-900 px-6 border-b border-slate-800"
        }
      >
        <div
          className={
            isSample
              ? "flex items-center gap-space-xs font-body-sm text-body-sm text-outline"
              : "flex items-center gap-2 text-sm text-slate-400"
          }
        >
          <Link to="/categories" className="hover:text-white transition-colors">Categories</Link>
          <span>/</span>
          {project?.category_id ? (
            <Link to={`/projects?category_id=${project.category_id}`} className="hover:text-white transition-colors">
              {project?.category_name || `Category ${project.category_id}`}
            </Link>
          ) : (
            <Link to="/projects" className="hover:text-white transition-colors">Projects Directory</Link>
          )}
          <span>/</span>
          <span
            className={
              isSample
                ? "text-primary font-label-mono font-semibold"
                : "text-indigo-300 font-mono font-semibold"
            }
          >
            {project?.code || "..."}
          </span>
          <span>/</span>
          <span
            className={
              isSample
                ? "text-on-surface font-title-sm text-title-sm"
                : "text-slate-100 font-semibold"
            }
          >
            {project?.name || "Loading..."}
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs">
          {project?.task_count !== undefined && (
            <div
              className={
                isSample
                  ? "px-space-sm py-0.5 rounded bg-surface-container text-on-surface-variant text-label-mono font-label-mono"
                  : "px-2.5 py-1 rounded bg-slate-800 text-slate-300"
              }
            >
              Tasks: <span className={isSample ? "font-semibold text-on-surface" : "font-semibold text-white"}>{project.task_count}</span>
            </div>
          )}
          {project?.start_date && (
            <div
              className={
                isSample
                  ? "px-space-sm py-0.5 rounded bg-surface-container text-on-surface-variant text-label-mono font-label-mono"
                  : "px-2.5 py-1 rounded bg-slate-800 text-slate-300"
              }
            >
              Span: <span className={isSample ? "text-on-surface" : "text-white"}>{project.start_date} {project.target_date ? `to ${project.target_date}` : ""}</span>
            </div>
          )}
          {project?.owner_name && (
            <div
              className={
                isSample
                  ? "px-space-sm py-0.5 rounded bg-surface-container text-on-surface-variant text-label-mono font-label-mono"
                  : "px-2.5 py-1 rounded bg-slate-800 text-slate-300"
              }
            >
              Owner: <span className={isSample ? "text-on-surface" : "text-white"}>{project.owner_name}</span>
            </div>
          )}
          <div className={isSample ? "text-outline" : "text-slate-400"}>
            {auth.username} ({auth.role})
          </div>
          <ThemeToggle />
        </div>
      </div>
      <TabBar role={auth.role} />
      {id && (
        <div
          className={
            isSample
              ? "px-space-xl py-space-xs bg-surface-container-lowest border-b border-subtle"
              : "px-6 py-2 bg-slate-900/60 border-b border-slate-800"
          }
        >
          <LinkedProjects projectId={id} />
        </div>
      )}
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
        path="/categories"
        element={auth.accessToken ? <Categories /> : <Navigate to="/login" replace />}
      />
      <Route
        path="/projects"
        element={auth.accessToken ? <Projects /> : <Navigate to="/login" replace />}
      />
      <Route path="/projects/:id/*" element={<ProjectShell />} />
      <Route path="*" element={<Navigate to={auth.accessToken ? "/categories" : "/login"} replace />} />
    </Routes>
  );
}
