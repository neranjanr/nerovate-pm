import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchMe, useAuth } from "../stores/auth";
import { useTheme } from "../stores/theme";

export default function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const auth = useAuth();
  const { theme, setTheme } = useTheme();
  const nav = useNavigate();
  const isSample = theme === "sample";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const r = await fetch("/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });
    if (!r.ok) {
      setError("Invalid credentials");
      return;
    }
    const body = (await r.json()) as { access_token: string };
    const me = await fetchMe(body.access_token);
    auth.login(body.access_token, me.role, me.username);
    nav("/projects");
  };

  return (
    <main
      className={
        isSample
          ? "min-h-screen grid place-items-center bg-surface text-on-surface"
          : "min-h-screen grid place-items-center bg-slate-950 text-slate-100"
      }
    >
      <form
        onSubmit={submit}
        className={
          isSample
            ? "w-80 flex flex-col gap-space-sm bg-surface-container-lowest p-space-lg rounded shadow-xl"
            : "w-80 flex flex-col gap-3 bg-slate-900 p-6 rounded"
        }
      >
        <h1 className={isSample ? "text-headline-md font-headline-md" : "text-lg font-semibold"}>Nerovate-PM — Login</h1>
        <div className="flex items-center gap-2 text-xs">
          <span className={isSample ? "text-outline" : "text-slate-400"}>Theme:</span>
          <button
            type="button"
            onClick={() => setTheme("sample")}
            className={`px-2 py-0.5 rounded ${isSample ? "bg-primary-container text-on-primary-container" : "bg-slate-800 text-slate-300"}`}
          >
            Sample
          </button>
          <button
            type="button"
            onClick={() => setTheme("legacy")}
            className={`px-2 py-0.5 rounded ${!isSample ? "bg-indigo-600 text-white" : "bg-surface-container-high text-on-surface-variant"}`}
          >
            Legacy
          </button>
        </div>
        <input
          aria-label="username"
          className={
            isSample
              ? "px-space-md py-1 rounded bg-surface-container-low text-on-surface text-body-sm font-body-sm"
              : "px-3 py-2 rounded bg-slate-800"
          }
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <input
          aria-label="password"
          type="password"
          className={
            isSample
              ? "px-space-md py-1 rounded bg-surface-container-low text-on-surface text-body-sm font-body-sm"
              : "px-3 py-2 rounded bg-slate-800"
          }
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <p role="alert">{error}</p>}
        <button
          type="submit"
          className={
            isSample
              ? "px-space-md py-1 rounded bg-priority-normal hover:bg-inverse-primary text-white text-body-sm font-body-sm shadow-md transition-all"
              : "px-3 py-2 rounded bg-indigo-500 text-white"
          }
        >
          Login
        </button>
      </form>
    </main>
  );
}
