import { Suspense, lazy, useEffect, useState } from "react";
import { Link, Navigate, Outlet, Route, Routes, useParams } from "react-router-dom";
import TabBar from "./components/TabBar";
import Sidebar from "./components/Sidebar";
import GlobalHeader from "./components/GlobalHeader";
import SessionIdleWatcher from "./components/SessionIdleWatcher";
import GlobalSettings from "./pages/GlobalSettings";
import Help from "./pages/Help";
import { REGISTRY } from "./modules/registry";
import Login from "./pages/Login";
import Categories from "./pages/Categories";
import CategoryDetail from "./pages/CategoryDetail";
import Projects from "./pages/Projects";
import LinkedProjects from "./components/LinkedProjects";
const CategoryStatusView = lazy(() => import("./pages/StatusView"));
const CategoryKanbanView = lazy(() => import("./pages/Kanban"));
const CategoryMindMapView = lazy(() => import("./pages/MindMap"));
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
  const opts: VisualTheme[] = ["enterprise", "sample", "legacy"];
  return (
    <div
      className="flex items-center rounded p-0.5 border border-subtle bg-surface-container"
      title="Visual theme (design tokens only)"
    >
      {opts.map((o) => (
        <button
          key={o}
          onClick={() => setTheme(o)}
          className={`px-2.5 py-1 rounded text-xs font-medium capitalize transition-colors ${
            theme === o ? "bg-primary-container text-on-primary" : "text-on-surface-variant hover:text-on-surface"
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

  const isSample = theme !== "legacy";

  return (
    <div
      className={
        isSample
          ? "min-h-screen bg-surface text-on-surface flex flex-col"
          : "min-h-screen bg-surface text-on-surface flex flex-col"
      }
      style={{ colorScheme: "light" }}
    >
      <div
        className={
          isSample
            ? "flex flex-wrap items-center justify-between gap-space-md py-space-sm bg-surface-container-lowest px-space-xl border-b border-subtle"
            : "flex flex-wrap items-center justify-between gap-4 py-3 bg-surface-container-lowest px-6 border-b border-subtle"
        }
      >
        <div
          className={
            isSample
              ? "flex items-center gap-space-xs font-body-sm text-body-sm text-outline"
              : "flex items-center gap-2 text-sm text-on-surface-variant"
          }
        >
          <Link to="/categories" className="hover:text-on-surface transition-colors">Categories</Link>
          <span>/</span>
          {project?.category_id ? (
            <Link to={`/projects?category_id=${project.category_id}`} className="hover:text-on-surface transition-colors">
              {project?.category_name || `Category ${project.category_id}`}
            </Link>
          ) : (
            <Link to="/projects" className="hover:text-on-surface transition-colors">Projects Directory</Link>
          )}
          <span>/</span>
          <span
            className={
              isSample
                ? "text-primary font-label-mono font-semibold"
                : "text-primary font-mono font-semibold"
            }
          >
            {project?.code || "..."}
          </span>
          <span>/</span>
          <span
            className={
              isSample
                ? "text-on-surface font-title-sm text-title-sm"
                : "text-on-surface font-semibold"
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
                  : "px-2.5 py-1 rounded bg-surface-container text-on-surface-variant"
              }
            >
              Tasks: <span className={isSample ? "font-semibold text-on-surface" : "font-semibold text-on-primary"}>{project.task_count}</span>
            </div>
          )}
          {project?.start_date && (
            <div
              className={
                isSample
                  ? "px-space-sm py-0.5 rounded bg-surface-container text-on-surface-variant text-label-mono font-label-mono"
                  : "px-2.5 py-1 rounded bg-surface-container text-on-surface-variant"
              }
            >
              Span: <span className={isSample ? "text-on-surface" : "text-on-primary"}>{project.start_date} {project.target_date ? `to ${project.target_date}` : ""}</span>
            </div>
          )}
          {project?.owner_name && (
            <div
              className={
                isSample
                  ? "px-space-sm py-0.5 rounded bg-surface-container text-on-surface-variant text-label-mono font-label-mono"
                  : "px-2.5 py-1 rounded bg-surface-container text-on-surface-variant"
              }
            >
              Owner: <span className={isSample ? "text-on-surface" : "text-on-primary"}>{project.owner_name}</span>
            </div>
          )}
          <ThemeToggle />
        </div>
      </div>
      <TabBar role={auth.role} />
      {id && (
        <div
          className={
            isSample
              ? "px-space-xl py-space-xs bg-surface-container-lowest border-b border-subtle"
              : "px-6 py-2 bg-surface-container-low border-b border-subtle"
          }
        >
          <LinkedProjects projectId={id} />
        </div>
      )}
      <div className="flex-1">
        <Suspense fallback={<div className="p-6">Loading…</div>}>
          <Outlet />
        </Suspense>
      </div>
    </div>
  );
}

export default function App() {
  const auth = useAuth();
  const shell = (
    <div className="min-h-screen bg-surface text-on-surface flex flex-col" style={{ colorScheme: "light" }}>
      <SessionIdleWatcher />
      <GlobalHeader />
      <div className="flex-1 flex flex-col">
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/categories"
            element={auth.accessToken ? <Categories /> : <Navigate to="/login" replace />}
          />
          <Route
            path="/categories/:id"
            element={auth.accessToken ? <CategoryDetail /> : <Navigate to="/login" replace />}
          />
          <Route
            path="/categories/:id/status"
            element={
              auth.accessToken ? (
                <Suspense fallback={<div className="p-6">Loading…</div>}>
                  <CategoryStatusView />
                </Suspense>
              ) : (
                <Navigate to="/login" replace />
              )
            }
          />
          <Route
            path="/categories/:id/kanban"
            element={
              auth.accessToken ? (
                <Suspense fallback={<div className="p-6">Loading…</div>}>
                  <CategoryKanbanView />
                </Suspense>
              ) : (
                <Navigate to="/login" replace />
              )
            }
          />
          <Route
            path="/categories/:id/mindmap"
            element={
              auth.accessToken ? (
                <Suspense fallback={<div className="p-6">Loading…</div>}>
                  <CategoryMindMapView />
                </Suspense>
              ) : (
                <Navigate to="/login" replace />
              )
            }
          />
          <Route
            path="/projects"
            element={auth.accessToken ? <Projects /> : <Navigate to="/login" replace />}
          />
          <Route
            path="/settings"
            element={auth.accessToken ? <GlobalSettings /> : <Navigate to="/login" replace />}
          />
          <Route
            path="/help"
            element={auth.accessToken ? <Help /> : <Navigate to="/login" replace />}
          />
          <Route path="/projects/:id" element={<ProjectShell />}>
            <Route index element={<Navigate to="list" replace />} />
            {auth.role &&
              REGISTRY.filter((e) => e.requiredRole.includes(auth.role!)).map((e) => (
                <Route key={e.id} path={e.route} element={<e.component />} />
              ))}
          </Route>
          <Route path="*" element={<Navigate to={auth.accessToken ? "/projects" : "/login"} replace />} />
        </Routes>
      </div>
    </div>
  );
  if (!auth.accessToken) return shell;
  return (
    <div className="min-h-screen bg-surface text-on-surface flex" style={{ colorScheme: "light" }}>
      <Sidebar />
      <div className="flex-1 min-w-0 flex flex-col">{shell}</div>
    </div>
  );
}
