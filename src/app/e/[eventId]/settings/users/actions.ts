"use server";

import { revalidatePath } from "next/cache";
import type { Role } from "@/domain/permissions";
import { adminSendReset, changeRole, inviteUser, removeUser } from "@/domain/users";
import { formError, requireUser, type FormState } from "@/lib/session";

const path = (eventId: string) => `/e/${eventId}/settings/users`;

export async function inviteAction(eventId: string, _: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  try {
    const r = await inviteUser({ userId: user.id }, eventId, {
      name: String(form.get("name") ?? ""),
      email: String(form.get("email") ?? ""),
      role: String(form.get("role") ?? "") as Role,
    });
    revalidatePath(path(eventId));
    return { ok: r.restored ? "Access restored and an email sent." : "Invitation sent." };
  } catch (err) {
    return formError(err);
  }
}

export async function changeRoleAction(eventId: string, userId: string, role: Role): Promise<FormState> {
  const user = await requireUser();
  try {
    await changeRole({ userId: user.id }, eventId, userId, role);
    revalidatePath(path(eventId));
    return { ok: "Role changed." };
  } catch (err) {
    return formError(err);
  }
}

export async function removeUserAction(eventId: string, userId: string): Promise<FormState> {
  const user = await requireUser();
  try {
    await removeUser({ userId: user.id }, eventId, userId);
    revalidatePath(path(eventId));
    return { ok: "Removed." };
  } catch (err) {
    return formError(err);
  }
}

export async function sendResetAction(eventId: string, userId: string): Promise<FormState> {
  const user = await requireUser();
  try {
    await adminSendReset({ userId: user.id }, eventId, userId);
    return { ok: "Reset link sent." };
  } catch (err) {
    return formError(err);
  }
}
