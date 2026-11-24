import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_DAYS, userForSession } from "@/domain/users";
import { AppError } from "@/lib/errors";

const COOKIE = "ys_session";

export async function setSessionCookie(token: string) {
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 3600,
  });
}

export async function sessionToken(): Promise<string | undefined> {
  return (await cookies()).get(COOKIE)?.value;
}

export async function clearSessionCookie() {
  (await cookies()).delete(COOKIE);
}

export async function currentUser() {
  return userForSession(await sessionToken());
}

/** The signed-in user, or a redirect to the sign-in page. */
export async function requireUser() {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}

export interface FormState {
  error?: string;
  ok?: string;
}

/** Turns errors meant for the user into form messages; anything else is re-thrown. */
export function formError(err: unknown): FormState {
  if (err instanceof AppError) return { error: err.message };
  throw err;
}
