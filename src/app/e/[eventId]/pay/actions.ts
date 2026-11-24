"use server";

import { revalidatePath } from "next/cache";
import { getCheckout, cancelCheckout, emailPaymentLink, startCheckout, syncCheckout } from "@/domain/square";
import { AppError } from "@/lib/errors";
import { requireUser } from "@/lib/session";

type Result<T> = ({ status: "ok" } & T) | { status: "error"; error: string };

async function run<T extends object>(fn: (userId: string) => Promise<T>): Promise<Result<T>> {
  const user = await requireUser();
  try {
    return { status: "ok", ...(await fn(user.id)) };
  } catch (err) {
    if (err instanceof AppError) return { status: "error", error: err.message };
    throw err;
  }
}

export async function startTerminalAction(eventId: string, customerIds: string[], deviceId: string) {
  return run(async (userId) => ({
    checkoutId: await startCheckout({ userId }, eventId, customerIds, { kind: "terminal", deviceId }),
  }));
}

export async function startLinkAction(eventId: string, customerIds: string[], buyerEmail: string | null) {
  return run(async (userId) => ({
    checkoutId: await startCheckout({ userId }, eventId, customerIds, { kind: "link", buyerEmail }),
  }));
}

/** Polled by the checkout screen. Asks Square, then reports the outcome. */
export async function pollCheckoutAction(eventId: string, checkoutId: string) {
  return run(async (userId) => {
    await getCheckout({ userId }, checkoutId); // permission check
    const state = await syncCheckout(checkoutId);
    if (state !== "pending") revalidatePath(`/e/${eventId}`, "layout");
    const c = await getCheckout({ userId }, checkoutId);
    return { state, cancelReason: c.cancelReason, oversold: c.oversold };
  });
}

export async function cancelCheckoutAction(eventId: string, checkoutId: string) {
  return run(async (userId) => {
    await cancelCheckout({ userId }, checkoutId);
    revalidatePath(`/e/${eventId}`, "layout");
    return {};
  });
}

export async function emailLinkAction(checkoutId: string, to: string) {
  return run(async (userId) => {
    await emailPaymentLink({ userId }, checkoutId, to);
    return {};
  });
}
