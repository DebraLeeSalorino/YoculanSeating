"use server";

import { redirect } from "next/navigation";
import { acceptInvite, createSession, endSession, requestPasswordReset, resetPassword, signIn } from "@/domain/users";
import { clearSessionCookie, formError, sessionToken, setSessionCookie, type FormState } from "@/lib/session";

export async function signInAction(_: FormState, form: FormData): Promise<FormState> {
  const result = await signIn(String(form.get("email") ?? ""), String(form.get("password") ?? ""));
  if (!result) return { error: "That email and password don't match an account with access." };
  await setSessionCookie(result.token);
  redirect("/");
}

export async function forgotAction(_: FormState, form: FormData): Promise<FormState> {
  await requestPasswordReset(String(form.get("email") ?? ""));
  return { ok: "If that email has an account, a reset link is on its way. It works once and expires in one hour." };
}

export async function resetAction(_: FormState, form: FormData): Promise<FormState> {
  const password = String(form.get("password") ?? "");
  if (password !== String(form.get("confirm") ?? "")) return { error: "The two passwords don't match." };
  let userId: string;
  try {
    userId = await resetPassword(String(form.get("token") ?? ""), password);
  } catch (err) {
    return formError(err);
  }
  await setSessionCookie(await createSession(userId));
  redirect("/");
}

export async function acceptInviteAction(_: FormState, form: FormData): Promise<FormState> {
  const password = String(form.get("password") ?? "");
  if (password !== String(form.get("confirm") ?? "")) return { error: "The two passwords don't match." };
  let userId: string;
  try {
    userId = await acceptInvite(String(form.get("token") ?? ""), password);
  } catch (err) {
    return formError(err);
  }
  await setSessionCookie(await createSession(userId));
  redirect("/");
}

export async function signOutAction() {
  const token = await sessionToken();
  if (token) await endSession(token);
  await clearSessionCookie();
  redirect("/login");
}
