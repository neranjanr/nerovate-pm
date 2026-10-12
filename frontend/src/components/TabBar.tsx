import { NavLink } from "react-router-dom";
import { allowedViews, type Role } from "../modules/registry";

// View switcher modeled on samplelist.html: a single card bar with the
// active view as a pill. Kanban + List + Status View — Board/Gantt/etc. stay
// registered; only the nav is trimmed.
export default function TabBar({ role }: { role: Role }) {
  const views = allowedViews(role).filter((v) => v.id === "kanban" || v.id === "list" || v.id === "status" || v.id === "mindmap");
  return (
    <nav className="flex items-center gap-1 bg-surface-container-lowest px-3 py-1 rounded-xl shadow-sm overflow-x-auto">
      {views.map((v) => (
        <NavLink
          key={v.id}
          to={v.route}
          end={v.id === "list"}
          className={({ isActive }) =>
            isActive
              ? "flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary-container text-on-primary text-[13px] font-medium shadow-sm"
              : "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface text-[13px] transition-colors"
          }
        >
          <span aria-hidden="true">{v.id === "status" ? "◔" : v.id === "kanban" ? "▦" : v.id === "mindmap" ? "♡" : "☰"}</span>
          <span>{v.navLabel}</span>
        </NavLink>
      ))}
    </nav>
  );
}
