import { createContext, useContext, useState, type ReactNode } from "react";
import type { Role } from "../modules/registry";

interface AuthState {
  accessToken: string | null;
  role: Role | null;
  username: string | null;
  login: (accessToken: string, role: Role, username: string) => void;
  logout: () => void;
}

const AuthCtx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [accessToken, setAccessToken] = useState<string | null>(() =>
    localStorage.getItem("nrg_access")
  );
  const [role, setRole] = useState<Role | null>(
    () => (localStorage.getItem("nrg_role") as Role | null)
  );
  const [username, setUsername] = useState<string | null>(() =>
    localStorage.getItem("nrg_user")
  );

  const login = (token: string, r: Role, u: string) => {
    setAccessToken(token);
    setRole(r);
    setUsername(u);
    localStorage.setItem("nrg_access", token);
    localStorage.setItem("nrg_role", r);
    localStorage.setItem("nrg_user", u);
  };
  const logout = () => {
    setAccessToken(null);
    setRole(null);
    setUsername(null);
    localStorage.clear();
  };
  return (
    <AuthCtx.Provider value={{ accessToken, role, username, login, logout }}>
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth(): AuthState {
  const v = useContext(AuthCtx);
  if (!v) throw new Error("AuthProvider missing");
  return v;
}

export async function fetchMe(accessToken: string) {
  const r = await fetch("/api/v1/auth/me", {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!r.ok) throw new Error("me failed");
  return (await r.json()) as { username: string; role: Role };
}
