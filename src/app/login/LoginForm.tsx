"use client";
import { useActionState } from "react";
import { login } from "../actions";

export default function LoginForm() {
  const [state, action, pending] = useActionState(login, undefined);
  return (
    <form action={action} className="card">
      <label className="field">
        <span>Usuario</span>
        <input name="username" autoComplete="username" autoCapitalize="none" autoCorrect="off" required />
      </label>
      <label className="field">
        <span>PIN</span>
        <input name="pin" type="password" inputMode="numeric" autoComplete="current-password" pattern="[0-9]*" required />
      </label>
      {state?.error && <div className="alert ERROR" role="alert">{state.error}</div>}
      <button className="big" type="submit" disabled={pending} style={{ minHeight: 56 }}>
        {pending ? "Entrando…" : "Entrar"}
      </button>
    </form>
  );
}
