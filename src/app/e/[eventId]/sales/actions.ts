"use server";

import { revalidatePath } from "next/cache";
import { approveComps, compUnpaidTickets, declineComps } from "@/domain/comps";
import { takeCashPayment } from "@/domain/customers";
import { refundTickets } from "@/domain/refunds";
import { buyerPageLinkFor, resendBuyerPage } from "@/domain/buyer-page";
import { resolveOversold, retryCashInSquare } from "@/domain/square";
import { AppError } from "@/lib/errors";
import { requireUser } from "@/lib/session";

export type ActionResult = { status: "saved"; message?: string } | { status: "error"; error: string };

async function run(eventId: string, fn: (userId: string) => Promise<string | void>): Promise<ActionResult> {
  const user = await requireUser();
  try {
    const message = await fn(user.id);
    revalidatePath(`/e/${eventId}`, "layout");
    return { status: "saved", message: message ?? undefined };
  } catch (err) {
    if (err instanceof AppError) return { status: "error", error: err.message };
    throw err;
  }
}

export async function approveCompsAction(eventId: string, customerIds: string[]) {
  return run(eventId, (userId) => approveComps({ userId }, eventId, customerIds));
}

export async function declineCompsAction(eventId: string, customerIds: string[]) {
  return run(eventId, (userId) => declineComps({ userId }, eventId, customerIds));
}

export async function cashForTicketsAction(eventId: string, customerIds: string[]) {
  return run(eventId, (userId) => takeCashPayment({ userId }, eventId, customerIds));
}

export async function refundAction(eventId: string, customerIds: string[], reason: string) {
  return run(eventId, (userId) => refundTickets({ userId }, eventId, customerIds, reason));
}

export async function compUnpaidAction(eventId: string, customerIds: string[], sectionId: string | null, hostName: string) {
  return run(eventId, (userId) => compUnpaidTickets({ userId }, eventId, customerIds, { sectionId, hostName }));
}

export async function buyerLinkAction(eventId: string, customerId: string) {
  return run(eventId, (userId) => buyerPageLinkFor({ userId }, customerId));
}

export async function resendBuyerLinkAction(eventId: string, customerId: string) {
  return run(eventId, async (userId) => {
    await resendBuyerPage({ userId }, customerId);
    return "Buyer page link emailed.";
  });
}

export async function resolveOversoldAction(eventId: string, checkoutId: string) {
  return run(eventId, (userId) => resolveOversold({ userId }, checkoutId));
}

export async function retryCashAction(eventId: string) {
  return run(eventId, (userId) => retryCashInSquare({ userId }, eventId));
}
