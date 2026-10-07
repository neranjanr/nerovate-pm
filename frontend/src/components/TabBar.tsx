import { NavLink } from "react-router-dom";
import { allowedViews, type Role } from "../modules/registry";
import { useTheme } from "../stores/theme";

export default function TabBar({ role }: { role: Role }) {
  const views = allowedViews(role);
  const { theme } = useTheme();
  const isSample = theme === "sample";
  return (
    <nav
      className={
        isSample
          ? "flex items-center gap-space-xs bg-surface-container-low px-space-xl overflow-x-auto shadow-sm"
          : "flex items-center gap-2 bg-slate-900 px-4 overflow-x-auto border-b border-slate-800"
      }
    >      {views.map((v) => (
        <NavLink
          key={v.id}
          to={v.route}
          className={
            isSample
              ? "px-space-md py-1.5 text-on-surface-variant hover:text-on-surface text-body-md font-body-md transition-colors"
              : "px-3 py-1.5 text-sm hover:text-white text-slate-300"
          }
        >
          {v.navLabel}
        </NavLink>
      ))}
    </nav>
  );
}
