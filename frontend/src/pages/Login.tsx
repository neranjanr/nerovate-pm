import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { fetchMe, useAuth } from "../stores/auth";
import { consumeSessionExpired } from "../utils/sessionIdle";

export default function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const auth = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();

  useEffect(() => {
    if (params.get("expired") === "1" || consumeSessionExpired(sessionStorage)) {
      setNotice("Session expired after 15 minutes of inactivity — please log in again.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
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
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen grid place-items-center bg-surface text-on-surface px-4 py-10">
      <div className="relative w-full max-w-xl flex flex-col items-center">
        <div className="absolute -top-12 -left-16 w-64 h-64 bg-primary-fixed opacity-40 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-10 -right-12 w-64 h-64 bg-secondary-fixed opacity-50 rounded-full blur-3xl pointer-events-none" />

        <div className="relative w-full bg-surface-container-lowest/90 backdrop-blur-xl shadow-xl rounded-xl p-8 sm:p-10 flex flex-col gap-6">
          <div className="flex flex-col items-center text-center">
            <div className="relative mb-3 flex items-center justify-center">
              <div className="w-12 h-12 rounded-xl bg-primary-container text-on-primary shadow-md flex items-center justify-center">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path d="M12 2L20.6603 7V17L12 22L3.33975 17V7L12 2Z" fill="currentColor" fillOpacity="0.15" />
                  <path
                    d="M12 2L20.6603 7M12 2L3.33975 7M12 2V22M20.6603 7V17L12 22M3.33975 7V17L12 22M20.6603 7L12 12M3.33975 7L12 12"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="1.75"
                  />
                </svg>
              </div>
              <span className="absolute -bottom-1 -right-1 px-1.5 rounded-full bg-tertiary-container text-on-tertiary text-[11px] font-semibold tracking-wider uppercase scale-90">
                v3.4
              </span>
            </div>
            <div className="flex items-center gap-1.5 justify-center mb-1">
              <span className="text-[18px] leading-6 font-semibold tracking-tight">Nerovate-PM</span>
              <span className="text-[11px] font-semibold uppercase tracking-wider bg-surface-container text-primary px-1.5 py-0.5 rounded">
                PM Suite
              </span>
            </div>
            <h1 className="text-[24px] leading-[30px] font-semibold tracking-tight mt-1">
              Welcome back to your workspace
            </h1>
            <p className="text-[13px] leading-[18px] text-on-surface-variant max-w-sm mt-1">
              Streamline sprints, manage lifecycle milestones, and synchronize teams effortlessly.
            </p>
          </div>

          <div className="flex flex-col gap-2.5">
            <button
              className="group relative w-full h-11 px-4 bg-surface-container-low hover:bg-surface-container text-on-surface rounded-lg flex items-center justify-between shadow-sm transition-all duration-150"
              type="button"
              title="Google login will be introduced soon."
              onClick={() => setNotice("Google login will be introduced soon.")}
            >
              <span className="flex items-center gap-3">
                <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                  <path
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    fill="#4285F4"
                  />
                  <path
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    fill="#34A853"
                  />
                  <path
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                    fill="#FBBC05"
                  />
                  <path
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                    fill="#EA4335"
                  />
                </svg>
                <span className="text-[13px] font-medium">Continue with Google Workspace</span>
              </span>
              <span className="hidden sm:inline-flex items-center text-[12px] text-primary bg-primary-fixed px-2 py-0.5 rounded-full">
                Instant SSO
              </span>
            </button>
            <button
              className="w-full h-10 px-4 bg-surface-container-lowest hover:bg-surface-container-low text-on-surface-variant hover:text-on-surface rounded-lg flex items-center justify-between shadow-sm transition-all duration-150"
              type="button"
              title="SAML SSO will be introduced soon."
              onClick={() => setNotice("SAML SSO will be introduced soon.")}
            >
              <span className="flex items-center gap-2.5">
                <span className="text-[18px] text-secondary" aria-hidden="true">
                  ▣
                </span>
                <span className="text-[12px]">Sign in with SAML SSO / Okta</span>
              </span>
              <span aria-hidden="true">→</span>
            </button>
            {notice && (
              <p role="status" className="text-[12px] text-on-surface-variant bg-surface-container px-3 py-2 rounded-lg">
                {notice}
              </p>
            )}
          </div>

          <div className="relative flex items-center justify-center my-1">
            <div className="w-full h-px bg-surface-container" />
            <span className="absolute px-3 bg-surface-container-lowest text-on-surface-variant text-[12px] uppercase tracking-wider">
              or continue with user name
            </span>
          </div>

          <form className="flex flex-col gap-4" onSubmit={submit}>
            <div className="flex flex-col gap-1.5">
              <label className="text-[13px] font-medium flex items-center gap-1" htmlFor="usernameInput">
                User Name <span className="text-error">*</span>
              </label>
              <div className="relative flex items-center">
                <span className="absolute left-3 text-outline text-[18px] pointer-events-none" aria-hidden="true">
                  ✉
                </span>
                <input
                  id="usernameInput"
                  aria-label="username"
                  autoComplete="username"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="neranjan"
                  className="w-full h-11 pl-9 pr-3 rounded-lg bg-surface-container-low text-on-surface placeholder:text-outline text-[13px] focus:bg-surface-container-lowest focus:outline-none focus:shadow-[0_0_0_2px_rgba(79,70,229,0.3)] transition-all"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[13px] font-medium flex items-center gap-1" htmlFor="passwordInput">
                  Password <span className="text-error">*</span>
                </label>
                <button
                  type="button"
                  className="text-[12px] text-primary hover:underline"
                  title="Password reset will be introduced soon."
                  onClick={() => setNotice("Password reset will be introduced soon.")}
                >
                  Forgot password?
                </button>
              </div>
              <div className="relative flex items-center">
                <span className="absolute left-3 text-outline text-[18px] pointer-events-none" aria-hidden="true">
                  🔒
                </span>
                <input
                  id="passwordInput"
                  aria-label="password"
                  autoComplete="current-password"
                  required
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full h-11 pl-9 pr-10 rounded-lg bg-surface-container-low text-on-surface placeholder:text-outline text-[13px] focus:bg-surface-container-lowest focus:outline-none focus:shadow-[0_0_0_2px_rgba(79,70,229,0.3)] transition-all"
                />
                <button
                  className="absolute right-2.5 text-outline hover:text-on-surface p-1 rounded transition-colors text-[18px]"
                  title="Toggle visibility"
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? "◉" : "◎"}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between pt-1">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  defaultChecked
                  className="w-4 h-4 rounded bg-surface-container-low text-primary-container accent-primary-container cursor-pointer"
                  type="checkbox"
                />
                <span className="text-[12px] text-on-surface-variant">Remember this device for 30 days</span>
              </label>
            </div>

            {error && (
              <p role="alert" className="text-[12px] text-error bg-error-container px-3 py-2 rounded-lg">
                {error}
              </p>
            )}

            <button
              className="w-full h-11 mt-1 bg-primary-container hover:bg-primary text-on-primary text-[18px] leading-6 font-semibold rounded-lg shadow-md flex items-center justify-center gap-2 transition-all duration-150 active:scale-[0.99] disabled:opacity-80"
              type="submit"
              disabled={busy}
            >
              <span>{busy ? "Authenticating..." : "Sign In to Workspace"}</span>
              <span aria-hidden="true">→</span>
            </button>
          </form>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-center gap-4 text-on-surface-variant text-[12px]">
          <span className="hover:text-on-surface transition-colors">Privacy Notice</span>
          <span>•</span>
          <span className="hover:text-on-surface transition-colors">Terms of Use</span>
          <span>•</span>
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-tertiary-container" />
            <span className="font-mono text-[12px]">All API Services 99.99%</span>
          </div>
        </div>
      </div>
    </main>
  );
}
