import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../api";
import { useStore } from "../store";
import type { User } from "../types";
import { Button, Notice, PageHeader } from "../components/ui";

export function AuthPage() {
  const [params] = useSearchParams();
  const [mode, setMode] = useState<"signin" | "signup">(params.get("mode") === "signup" ? "signup" : "signin");
  const next = params.get("next") ?? "/";
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";
  const { setUser, toast, cartCount } = useStore();
  const nav = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [marketing, setMarketing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ user: User }>(mode === "signup" ? "/auth/register" : "/auth/login", {
        body: mode === "signup" ? { name, email, password, marketingOptIn: marketing } : { email, password },
      });
      setUser(r.user);
      toast(mode === "signup" ? `Welcome to Brewline, ${r.user.name.split(" ")[0]}!` : "Signed in", "success");
      nav(r.user.role === "barista" ? "/barista" : r.user.role === "manager" ? "/manager" : safeNext, { replace: true });
    } catch (err) {
      const a = err as ApiError;
      setError({ message: a.message, field: a.details?.field });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page auth-page">
      <PageHeader title={mode === "signup" ? "Create account" : "Sign in"} back />
      {cartCount > 0 ? <Notice tone="info">Your bag is saved — you'll go straight back to it after signing in.</Notice> : null}
      <form onSubmit={submit} className="form" noValidate>
        {mode === "signup" ? (
          <label className="field">
            <span>Name</span>
            <input autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} aria-invalid={error?.field === "name"} />
            <span className="hint">Shown on your pickup label as first name and last initial.</span>
          </label>
        ) : null}
        <label className="field">
          <span>Email</span>
          <input type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} required aria-invalid={error?.field === "email"} />
        </label>
        <label className="field">
          <span>Password</span>
          <input type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} aria-invalid={error?.field === "password"} />
          {mode === "signup" ? <span className="hint">At least 8 characters.</span> : null}
        </label>
        {mode === "signup" ? (
          <label className="check-row">
            <input type="checkbox" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} />
            <span>Send me occasional offers by email (optional). Order updates are always shown in the app.</span>
          </label>
        ) : null}
        {error ? <Notice tone="error">{error.message}</Notice> : null}
        <Button type="submit" full busy={busy}>{mode === "signup" ? "Create account" : "Sign in"}</Button>
      </form>
      <p className="center">
        {mode === "signup" ? "Already have an account? " : "New to Brewline? "}
        <button className="link" onClick={() => { setMode(mode === "signup" ? "signin" : "signup"); setError(null); }}>
          {mode === "signup" ? "Sign in" : "Create an account"}
        </button>
      </p>
      <p className="center tiny muted">By continuing you agree to the Rewards rules shown on the <Link to="/rewards">Rewards</Link> page. We never see your card details — payments are handled by our payment provider.</p>
    </div>
  );
}
