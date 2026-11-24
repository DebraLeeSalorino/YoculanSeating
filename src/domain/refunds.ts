/**
 * Refunds (section 3.5). Tickets are non-refundable as a rule; an admin can refund one to correct
 * an error, with a reason. The ticket goes back on sale and the record is kept.
 */
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { assignments, customers, payments } from "@/db/schema";
import { conflict, invalid, notFound } from "@/lib/errors";
import { authorize, type Actor } from "./permissions";

export async function refundTickets(actor: Actor, eventId: string, customerIds: string[], reason: string) {
  await authorize(actor, eventId, "refund");
  const why = reason.trim();
  if (!why) throw invalid("Give a reason for the refund.");
  if (!customerIds.length) throw invalid("Choose the tickets to refund.");

  await db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(customers)
      .where(and(eq(customers.eventId, eventId), inArray(customers.id, customerIds), isNull(customers.deletedAt)));
    if (rows.length !== customerIds.length) throw notFound("One of those tickets");
    if (rows.some((r) => r.paymentStatus !== "paid")) throw conflict("Only paid tickets can be refunded.");

    for (const c of rows) {
      const [totals] = await tx
        .select({
          net: sql<number>`coalesce(sum(case when ${payments.kind} = 'payment' then ${payments.amountCents} else -${payments.amountCents} end), 0)::int`,
          method: sql<string>`(array_agg(${payments.method} order by ${payments.takenAt} desc) filter (where ${payments.kind} = 'payment'))[1]`,
        })
        .from(payments)
        .where(eq(payments.customerId, c.id));
      const method = (totals?.method ?? "cash") as "cash" | "eventbrite" | "square_terminal" | "square_link";
      if (method === "square_terminal" || method === "square_link") {
        throw invalid("Square refunds will be sent from the app once Square is connected.");
      }
      await tx.insert(payments).values({
        customerId: c.id,
        kind: "refund",
        amountCents: Math.max(0, totals?.net ?? 0),
        method,
        reason: why,
        takenBy: actor.userId,
        updatedBy: actor.userId,
      });
      await tx.delete(assignments).where(eq(assignments.customerId, c.id));
      await tx
        .update(customers)
        .set({ paymentStatus: "refunded", updatedAt: new Date(), updatedBy: actor.userId })
        .where(eq(customers.id, c.id));
    }
  });
}
