import { useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useStore } from "../store";
import type { Role, User } from "../types";
import { Button, Notice, Spinner } from "../components/ui";

/** Shows a staff sign-in screen unless the current user has the required role. */
export function StaffGate({ role, children }: { role: Role; children: ReactNode }) {
  const { user, userLoaded, setUser, config } = useStore();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!userLoaded) return <Spinner />;
  const allowed = user && (user.role === role || (role === "barista" && user.role === "manager"));
  if (allowed) return <>{children}</>;

  const signIn = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ user: User }>("/auth/login", { body: { email, password } });
      setUser(r.user);
      if (r.user.role === "customer") setError("This account doesn't have staff access. Ask a manager to add you.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const demo = async () => {
    setBusy(true);
    try {
      const r = await api<{ user: User }>("/auth/demo", { body: { role } });
      setUser(r.user);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="staff-login">
      <div className="staff-login-card">
        <div className="brand-mark big">Brewline</div>
        <h1>{role === "manager" ? "Manager console" : "Barista display"}</h1>
        {user && !allowed ? <Notice tone="warn">Signed in as {user.email}, which doesn't have {role} access.</Notice> : null}
        <form className="form" onSubmit={signIn}>
          <label className="field"><span>Staff email</span><input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
          <label className="field"><span>Password</span><input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
          {error ? <Notice tone="error">{error}</Notice> : null}
          <Button type="submit" full busy={busy}>Sign in</Button>
        </form>
        {config?.demoMode ? (
          <div className="demo-box">
            <p className="small">Portfolio demo: explore without an account.</p>
            <Button variant="accent" full busy={busy} onClick={demo}>Continue as demo {role}</Button>
          </div>
        ) : null}
        <p className="center small"><Link to="/" className="link">← Back to the customer app</Link></p>
      </div>
    </div>
  );
}
