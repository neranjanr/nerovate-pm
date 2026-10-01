import { Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import TabBar from "./components/TabBar";
import { REGISTRY } from "./modules/registry";
import Login from "./pages/Login";
import Projects from "./pages/Projects";
import { useAuth } from "./stores/auth";

function ProjectShell() {
  const auth = useAuth();
  if (!auth.accessToken || !auth.role) return <Navigate to="/login" replace />;
  return (
    <div>
      <div className="px-4 py-2 text-xs text-slate-400">
        {auth.username} ({auth.role})
      </div>
      <TabBar role={auth.role} />
      <Suspense fallback={<div>Loading…</div>}>
        <Routes>
          <Route index element={<Navigate to="timeline" replace />} />
          {REGISTRY.filter((e) => e.requiredRole.includes(auth.role!)).map((e) => (
            <Route key={e.id} path={e.route} element={<e.component />} />
          ))}
        </Routes>
      </Suspense>
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
