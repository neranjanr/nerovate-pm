import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

// Visual Theme (design tokens only). Distinct from Project Template
// (reusable Status Profile + field defs) and Status Profile (ordered Statuses).
// "enterprise" is the sampleproj.html slate/white look and is the default.
// "sample" / "legacy" are kept so the theme stays changeable later.
export type VisualTheme = "enterprise" | "sample" | "legacy";

interface ThemeState {
  theme: VisualTheme;
  setTheme: (t: VisualTheme) => void;
}

import { LEGACY_THEME_KEY, readWithFallback, THEME_KEY, writeNewKey } from "./storageKeys";

const KEY = THEME_KEY;
const ThemeCtx = createContext<ThemeState | null>(null);

function initial(): VisualTheme {
  const v = readWithFallback(localStorage, THEME_KEY, LEGACY_THEME_KEY);
  if (v === "legacy") return "legacy";
  if (v === "sample") return "sample";
  if (v === "enterprise") return "enterprise";
  return "enterprise";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<VisualTheme>(() =>
    typeof window === "undefined" ? "sample" : initial()
  );

  useEffect(() => {
    document.documentElement.classList.remove("dark");
    document.documentElement.classList.add("light");
    document.documentElement.style.colorScheme = "light";
    document.documentElement.dataset.theme = theme;
    writeNewKey(localStorage, KEY, LEGACY_THEME_KEY, theme);
  }, [theme]);

  const setTheme = (t: VisualTheme) => setThemeState(t);

  return <ThemeCtx.Provider value={{ theme, setTheme }}>{children}</ThemeCtx.Provider>;
}

export function useTheme(): ThemeState {
  const v = useContext(ThemeCtx);
  if (!v) throw new Error("ThemeProvider missing");
  return v;
}
