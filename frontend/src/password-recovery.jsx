import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "./api";
import { Field, FormError, SubmitButton } from "./components";
import { useStore } from "./context";

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const { config } = useStore();
  async function submit(e) {
    e.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      const result = await api("/auth/password/forgot", { method: "POST", body: { email } });
      setMessage(result.message);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return <section className="container section auth-page">
    <div className="auth-story"><h1>Forgot password?</h1><p>Recover access to your Virar Organics account using a private email link.</p><Link to="/login">Return to sign in</Link></div>
    <div className="auth-card"><h2>Reset your password</h2>
      {config.auth?.passwordReset?.enabled === false && <p role="status">Email password recovery is not configured yet. Contact your store administrator.</p>}
      {message ? <p role="status">{message}</p> : <form className="form-stack" onSubmit={submit}>
        <Field label="Account email address"><input name="email" type="email" autoComplete="email" required maxLength={190} value={email} onChange={e=>setEmail(e.target.value)}/></Field>
        <FormError error={error}/><SubmitButton busy={busy}>Send reset link</SubmitButton>
      </form>}
    </div>
  </section>;
}
export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [token] = useState(() => {
    const fragment = window.location.hash.slice(1);
    window.history.replaceState(null, "", window.location.pathname);
    return /^[A-Za-z0-9_-]{40,128}$/.test(fragment) ? fragment : "";
  });
  const [newPassword, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  async function submit(e) {
    e.preventDefault();
    if (newPassword !== confirm) { setError("Passwords do not match."); return; }
    setBusy(true); setError("");
    try {
      await api("/auth/password/reset", { method: "POST", body: { token, newPassword } });
      setDone(true); setPassword(""); setConfirm("");
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return <section className="container section auth-page">
    <div className="auth-story"><h1>Set a new password</h1><p>Choose a new, unique password for your account.</p></div>
    <div className="auth-card"><h2>Password recovery</h2>
      {done ? <><p role="status">Password updated. Previous sessions have been signed out.</p><button className="button primary" onClick={() => navigate("/login")}>Sign in</button></>
       : !token ? <><p role="alert">Reset link is missing or invalid.</p><Link to="/forgot-password">Request another link</Link></>
       : <form className="form-stack" onSubmit={submit}>
         <Field label="New password"><input type="password" autoComplete="new-password" minLength={10} maxLength={72} required value={newPassword} onChange={e=>setPassword(e.target.value)}/></Field>
         <Field label="Confirm new password"><input type="password" autoComplete="new-password" minLength={10} maxLength={72} required value={confirm} onChange={e=>setConfirm(e.target.value)}/></Field>
         <FormError error={error}/><SubmitButton busy={busy}>Reset password</SubmitButton>
       </form>}
    </div>
  </section>;
}
