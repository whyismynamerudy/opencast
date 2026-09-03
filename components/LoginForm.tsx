"use client";

import { FormEvent, useState } from "react";
import { ArrowRight, LockKeyhole } from "lucide-react";

export function LoginForm() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not sign in.");
      window.location.assign("/");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not sign in.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="login-shell">
      <form className="login-card" onSubmit={submit}>
        <div className="brand-lockup"><span className="brand-mark">◒</span><span>OpenCast</span></div>
        <div className="login-icon"><LockKeyhole size={18} /></div>
        <p className="eyebrow">PRIVATE EDITING WORKSPACE</p>
        <h1>Welcome back.</h1>
        <p>Sign in to edit.</p>
        <label>Username<input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} /></label>
        <label>Password<input autoComplete="current-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        {error && <p className="form-error">{error}</p>}
        <button className="login-submit" type="submit" disabled={submitting}>{submitting ? "Signing in…" : <>Enter workspace <ArrowRight size={15} /></>}</button>
        <small>Demo credentials: <code>admin</code> / <code>admin</code></small>
      </form>
    </main>
  );
}
