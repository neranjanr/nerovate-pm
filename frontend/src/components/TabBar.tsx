import { NavLink } from "react-router-dom";
import { allowedViews, type Role } from "../modules/registry";

export default function TabBar({ role }: { role: Role }) {
  const views = allowedViews(role);
  return (
    <nav className="flex items-center gap-2 bg-surface-container-low px-4 overflow-x-auto">
      {views.map((v) => (
        <NavLink
          key={v.id}
          to={v.route}
          className="px-3 py-1.5 text-sm hover:text-white text-slate-300"
        >
          {v.navLabel}
        </NavLink>
      ))}
    </nav>
  );
}
