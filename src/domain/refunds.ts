/**
 * Refunds (section 3.5). Tickets are non-refundable as a rule; an admin can refund one to correct
 * an error, with a reason. The ticket goes back on sale and the record is kept.
 *
 * - Square payments: the app sends the refund to Square itself, then records it.
 * - Cash: handed back and recorded.
 * - Eventbrite: refunded in Eventbrite by the admin, then recorded here.
 */
import { createHash } from "node:crypto";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { assignments, customers, events, payments } from "@/db/schema";
import { conflict, invalid, notFound } from "@/lib/errors";
import { getSquare, SquareError } from "@/lib/square/client";
import { authorize, type Actor } from "./permissions";

type Method = "cash" | "eventbrite" | "square_terminal" | "square_link";

interface Plan {
  customerId: string;
  netCents: number;
  method: Method;
  squarePaymentId: string | null;
}

export async function refundTickets(actor: Actor, eventId: string, customerIds: string[], reason: string) {
  await authorize(actor, eventId, "refund");
  const why = reason.trim();
  if (!why) throw invalid("Give a reason for the refund.");
  if (!customerIds.length) throw invalid("Choose the tickets to refund.");
  const [event] = await db.select().from(events).where(eq(events.id, eventId));
  if (!event) throw notFound("The event");

  const rows = await db
    .select()
    .from(customers)
    .where(and(eq(customers.eventId, eventId), inArray(customers.id, customerIds), isNull(customers.deletedAt)));
  if (rows.length !== customerIds.length) throw notFound("One of those tickets");
  if (rows.some((r) => r.paymentStatus !== "paid")) throw conflict("Only paid tickets can be refunded.");

  const plans: Plan[] = [];
  for (const c of rows) {
    const [net] = await db
      .select({
        cents: sql<number>`coalesce(sum(case when ${payments.kind} = 'payment' then ${payments.amountCents} else -${payments.amountCents} end), 0)::int`,
      })
      .from(payments)
      .where(eq(payments.customerId, c.id));
    const [last] = await db
      .select({ method: payments.method, ref: payments.squareReference })
      .from(payments)
      .where(and(eq(payments.customerId, c.id), eq(payments.kind, "payment")))
      .orderBy(desc(payments.takenAt))
      .limit(1);
    const method = (last?.method ?? "cash") as Method;
    plans.push({ customerId: c.id, netCents: Math.max(0, net?.cents ?? 0), method, squarePaymentId: last?.ref ?? null });
  }

  // Send card refunds to Square first. Each uses a fixed idempotency key, so retrying after a
  // failure never refunds twice.
  const squareRefs = new Map<string, string>();
  let failure: string | null = null;
  const cardPlans = plans.filter((p) => p.method === "square_terminal" || p.method === "square_link");
  if (cardPlans.length) {
    const sq = getSquare();
    if (!sq) throw invalid("Square isn't connected, so this card payment can't be refunded from the app.");
    for (const p of cardPlans) {
      if (!p.squarePaymentId) throw invalid("This card payment has no Square reference. Refund it in Square, then record it as cash.");
      if (p.netCents === 0) continue;
      const key = createHash("sha256").update(`refund:${p.customerId}:${p.squarePaymentId}:${p.netCents}`).digest("hex").slice(0, 40);
      try {
        const id = await sq.refundPayment({
          idempotencyKey: key,
          paymentId: p.squarePaymentId,
          amount: { amountCents: p.netCents, currency: event.currency },
          reason: why,
        });
        squareRefs.set(p.customerId, id);
      } catch (err) {
        if (!(err instanceof SquareError)) throw err;
        failure = `Square refused the refund: ${err.message}`;
        break;
      }
    }
  }

  const isCard = (p: Plan) => p.method === "square_terminal" || p.method === "square_link";
  // If Square refused one, record only the card refunds it already accepted, so nothing is
  // recorded that didn't happen and nothing that happened goes unrecorded.
  const recordable = failure
    ? plans.filter((p) => isCard(p) && squareRefs.has(p.customerId))
    : plans.filter((p) => !isCard(p) || squareRefs.has(p.customerId) || p.netCents === 0);
  await db.transaction(async (tx) => {
    for (const p of recordable) {
      await tx.insert(payments).values({
        customerId: p.customerId,
        kind: "refund",
        amountCents: p.netCents,
        method: p.method,
        reason: why,
        takenBy: actor.userId,
        squareReference: squareRefs.get(p.customerId) ?? null,
        updatedBy: actor.userId,
      });
      await tx.delete(assignments).where(eq(assignments.customerId, p.customerId));
      await tx
        .update(customers)
        .set({ paymentStatus: "refunded", updatedAt: new Date(), updatedBy: actor.userId })
        .where(eq(customers.id, p.customerId));
    }
  });
  if (failure) {
    throw invalid(recordable.length ? `${failure} ${recordable.length} ticket(s) were refunded before this and are recorded.` : failure);
  }
}
