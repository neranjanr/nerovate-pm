import { lazy } from "react";

export type Role = "admin" | "manager" | "member" | "guest";

export type ViewId =
  | "board"
  | "list"
  | "calendar"
  | "table"
  | "timeline"
  | "dashboard"
  | "workload"
  | "settings"
  | "users"
  | "templates";

export interface RouteEntry {
  id: ViewId;
  route: string;
  navLabel: string;
  requiredRole: Role[];
  component: React.LazyExoticComponent<() => JSX.Element>;
}

const Placeholder = (label: string) =>
  lazy(async () => ({ default: () => <div>{label}</div> }));

/**
 * Lazy module registry (SPEC-v0.2 section 7 rule 4 + section 5 global rules).
 * Tab bar renders only entries whose requiredRole includes the current role.
 * Backend enforces the same matrix; this file is the frontend mirror.
 */
export const REGISTRY: RouteEntry[] = [
  { id: "board", route: "board", navLabel: "Board", requiredRole: ["admin", "manager", "member", "guest"], component: Placeholder("Board") },
  { id: "list", route: "list", navLabel: "List", requiredRole: ["admin", "manager", "member", "guest"], component: lazy(() => import("../pages/List")) },
  { id: "calendar", route: "calendar", navLabel: "Calendar", requiredRole: ["admin", "manager", "member"], component: lazy(() => import("../pages/Calendar")) },
  { id: "table", route: "table", navLabel: "Table", requiredRole: ["admin", "manager", "member"], component: lazy(() => import("../pages/Table")) },
  { id: "timeline", route: "timeline", navLabel: "Execution Timeline", requiredRole: ["admin", "manager", "member"], component: lazy(() => import("../pages/Timeline")) },
  { id: "dashboard", route: "dashboard", navLabel: "Dashboard", requiredRole: ["admin", "manager", "member"], component: lazy(() => import("../pages/Dashboard")) },
  { id: "workload", route: "workload", navLabel: "Workload", requiredRole: ["admin", "manager"], component: lazy(() => import("../pages/Dashboard")) },
  { id: "settings", route: "settings", navLabel: "Settings", requiredRole: ["admin", "manager"], component: lazy(() => import("../pages/Settings")) },
];

export function allowedViews(role: Role): RouteEntry[] {
  return REGISTRY.filter((e) => e.requiredRole.includes(role));
}

export function canAccessView(role: Role, view: ViewId): boolean {
  return allowedViews(role).some((e) => e.id === view);
}
