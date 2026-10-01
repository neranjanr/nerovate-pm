import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchMe, useAuth } from "../stores/auth";

export default function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const auth = useAuth();
  const nav = useNavigate();

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
    <main className="min-h-screen grid place-items-center bg-slate-950 text-slate-100">
      <form onSubmit={submit} className="w-80 flex flex-col gap-3 bg-slate-900 p-6 rounded">
        <h1 className="text-lg font-semibold">NRG Projects — Login</h1>
        <input
          aria-label="username"
          className="px-3 py-2 rounded bg-slate-800"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <input
          aria-label="password"
          type="password"
          className="px-3 py-2 rounded bg-slate-800"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <p role="alert">{error}</p>}
        <button type="submit" className="px-3 py-2 rounded bg-indigo-500 text-white">
          Login
        </button>
      </form>
    </main>
  );
}
