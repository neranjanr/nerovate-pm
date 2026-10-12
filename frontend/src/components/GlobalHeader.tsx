import { useAuth } from "../stores/auth";

export default function GlobalHeader() {
  const auth = useAuth();

  if (!auth.accessToken) return null;

  // Top nav links removed: Categories / Projects / Global Settings / Help
  // all live in the left sidebar now. Header keeps brand + user only.
  return (
    <header className="bg-surface-container-lowest border-b border-subtle px-6 py-3 flex items-center justify-between text-sm" style={{ colorScheme: "light" }}>
      <div className="flex items-center gap-6">
        <span className="font-bold text-primary tracking-wider">NEROVATE-PM</span>
      </div>
      <div className="flex items-center gap-3 text-xs text-on-surface-variant">
        <span>{auth.username} ({auth.role})</span>
        <button
          onClick={() => {
            auth.logout();
            window.location.href = "/login";
          }}
          className="px-2.5 py-1 rounded bg-surface-container hover:bg-surface-container-high text-on-surface"
        >
          Logout
        </button>
      </div>
    </header>
  );
}
