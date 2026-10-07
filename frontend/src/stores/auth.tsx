import { createContext, useContext, useState, type ReactNode } from "react";
import type { Role } from "../modules/registry";
import { AUTH_KEYS, LEGACY_AUTH_KEYS, readWithFallback, writeNewKey } from "./storageKeys";

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
    readWithFallback(localStorage, AUTH_KEYS.access, LEGACY_AUTH_KEYS.access)
  );
  const [role, setRole] = useState<Role | null>(
    () => (readWithFallback(localStorage, AUTH_KEYS.role, LEGACY_AUTH_KEYS.role) as Role | null)
  );
  const [username, setUsername] = useState<string | null>(() =>
    readWithFallback(localStorage, AUTH_KEYS.user, LEGACY_AUTH_KEYS.user)
  );

  const login = (token: string, r: Role, u: string) => {
    setAccessToken(token);
    setRole(r);
    setUsername(u);
    writeNewKey(localStorage, AUTH_KEYS.access, LEGACY_AUTH_KEYS.access, token);
    writeNewKey(localStorage, AUTH_KEYS.role, LEGACY_AUTH_KEYS.role, r);
    writeNewKey(localStorage, AUTH_KEYS.user, LEGACY_AUTH_KEYS.user, u);
  };
  const logout = () => {
    setAccessToken(null);
    setRole(null);
    setUsername(null);
    for (const k of Object.values({ ...AUTH_KEYS, ...LEGACY_AUTH_KEYS })) {
      localStorage.removeItem(k);
    }
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
