"use client";

import Link from "next/link";
import { useActionState } from "react";
import type { FormState } from "@/lib/session";
import { acceptInviteAction, forgotAction, resetAction, signInAction } from "./actions";

function Notice({ state }: { state: FormState }) {
  if (state.error) return <div className="notice error" role="alert">{state.error}</div>;
  if (state.ok) return <div className="notice ok" role="status">{state.ok}</div>;
  return null;
}

export function SignInForm() {
  const [state, action, pending] = useActionState(signInAction, {});
  return (
    <form action={action}>
      <Notice state={state} />
      <div className="field">
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" autoComplete="username" required autoFocus />
      </div>
      <div className="field">
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      <button type="submit" disabled={pending}>Sign in</button>{" "}
      <Link href="/forgot">Forgot password?</Link>
    </form>
  );
}

export function ForgotForm() {
  const [state, action, pending] = useActionState(forgotAction, {});
  return (
    <form action={action}>
      <Notice state={state} />
      <div className="field">
        <label htmlFor="email">Your email</label>
        <input id="email" name="email" type="email" required autoFocus />
      </div>
      <button type="submit" disabled={pending}>Email me a reset link</button>{" "}
      <Link href="/login">Back to sign in</Link>
    </form>
  );
}

function NewPasswordFields() {
  return (
    <>
      <div className="field">
        <label htmlFor="password">New password (at least 10 characters)</label>
        <input id="password" name="password" type="password" autoComplete="new-password" minLength={10} required autoFocus />
      </div>
      <div className="field">
        <label htmlFor="confirm">Type it again</label>
        <input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={10} required />
      </div>
    </>
  );
}

export function ResetForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(resetAction, {});
  return (
    <form action={action}>
      <Notice state={state} />
      <input type="hidden" name="token" value={token} />
      <NewPasswordFields />
      <button type="submit" disabled={pending}>Set password</button>
    </form>
  );
}

export function AcceptInviteForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(acceptInviteAction, {});
  return (
    <form action={action}>
      <Notice state={state} />
      <input type="hidden" name="token" value={token} />
      <NewPasswordFields />
      <button type="submit" disabled={pending}>Create my account</button>
    </form>
  );
}
