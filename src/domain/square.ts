/**
 * Selling through Square (spec section 3.4): card payments on a Square Terminal or by payment
 * link, cash recorded in Square, and terminal pairing. A ticket becomes Paid only when Square
 * confirms the payment.
 */
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, type Tx, type Db } from "@/db";
import { checkouts, customers, events, groups, payments, squareConnections } from "@/db/schema";
import { AppError, conflict, invalid, notFound } from "@/lib/errors";
import { appUrl, getMailer } from "@/lib/mail/mailer";
import {
  getSquare,
  newIdempotencyKey,
  SANDBOX_TEST_DEVICE,
  SquareError,
  verifySquareSignature,
  type SquareGateway,
} from "@/lib/square/client";
import { assertCanPayFor, capacityFor, lockEventSales } from "./capacity";
import { authorize, type Actor } from "./permissions";
import { isValidEmail } from "./users";

type Q = Db | Tx;

export function squareConnected(): boolean {
  return getSquare() !== null;
}

function requireSquare(): SquareGateway {
  const sq = getSquare();
  if (!sq) throw invalid("Square isn't connected yet.");
  return sq;
}

/** Square's own messages are shown to staff, since they explain declines and setup problems. */
function squareFailure(err: unknown): never {
  if (err instanceof SquareError) throw invalid(`Square: ${err.message}`);
  throw err;
}

// ---------- Connection settings ----------

export interface Terminal {
  deviceId: string;
  name: string;
}

export async function connectionFor(q: Q, eventId: string) {
  const [c] = await q.select().from(squareConnections).where(eq(squareConnections.eventId, eventId));
  return c ?? null;
}

async function upsertConnection(eventId: string, actorId: string, patch: { locationId?: string | null; pairedTerminals?: Terminal[] }) {
  const existing = await connectionFor(db, eventId);
  if (existing) {
    await db
      .update(squareConnections)
      .set({ ...patch, updatedAt: new Date(), updatedBy: actorId })
      .where(eq(squareConnections.id, existing.id));
  } else {
    await db.insert(squareConnections).values({ eventId, ...patch, updatedBy: actorId });
  }
}

export async function squareSettings(actor: Actor, eventId: string) {
  await authorize(actor, eventId, "manageUsers");
  const sq = getSquare();
  if (!sq) return { connected: false as const };
  const conn = await connectionFor(db, eventId);
  let locations: { id: string; name: string; currency: string; status: string }[] = [];
  let error: string | null = null;
  try {
    locations = await sq.listLocations();
  } catch (err) {
    error = err instanceof SquareError ? err.message : "Square could not be reached.";
  }
  return {
    connected: true as const,
    environment: sq.environment,
    locationId: conn?.locationId ?? null,
    terminals: conn?.pairedTerminals ?? [],
    locations,
    error,
  };
}

export async function setSquareLocation(actor: Actor, eventId: string, locationId: string) {
  await authorize(actor, eventId, "manageUsers");
  const sq = requireSquare();
  const locations = await sq.listLocations().catch(squareFailure);
  const loc = locations.find((l) => l.id === locationId);
  if (!loc) throw invalid("Choose one of your Square locations.");
  const [event] = await db.select({ currency: events.currency }).from(events).where(eq(events.id, eventId));
  if (event && loc.currency !== event.currency) {
    throw invalid(`That location takes ${loc.currency}, but the event is priced in ${event.currency}. Change one to match.`);
  }
  await upsertConnection(eventId, actor.userId, { locationId });
  // Cash taken before a location was chosen can now be recorded.
  await retryCashInSquare(actor, eventId).catch(() => undefined);
}

/** Starts pairing: Square gives a code to type into the Terminal (Settings > Device code sign in). */
export async function startTerminalPairing(actor: Actor, eventId: string, name: string) {
  await authorize(actor, eventId, "manageUsers");
  const sq = requireSquare();
  const conn = await connectionFor(db, eventId);
  if (!conn?.locationId) throw invalid("Choose your Square location first.");
  const label = name.trim() || "Square Terminal";
  const code = await sq.createDeviceCode({ idempotencyKey: newIdempotencyKey(), locationId: conn.locationId, name: label }).catch(squareFailure);
  return { codeId: code.id, code: code.code, name: label };
}

/** Checks whether the Terminal has been signed in with the code; adds it once it has. */
export async function checkTerminalPairing(actor: Actor, eventId: string, codeId: string, name: string) {
  await authorize(actor, eventId, "manageUsers");
  const sq = requireSquare();
  const code = await sq.getDeviceCode(codeId).catch(squareFailure);
  if (code.status === "PAIRED" && code.deviceId) {
    await addTerminal(eventId, actor.userId, { deviceId: code.deviceId, name: name.trim() || "Square Terminal" });
  }
  return code.status;
}

async function addTerminal(eventId: string, actorId: string, t: Terminal) {
  const conn = await connectionFor(db, eventId);
  const list = (conn?.pairedTerminals ?? []).filter((x) => x.deviceId !== t.deviceId);
  await upsertConnection(eventId, actorId, { pairedTerminals: [...list, t] });
}

/** Sandbox only: adds Square's test terminal, which approves card payments up to $25. */
export async function addSandboxTestTerminal(actor: Actor, eventId: string) {
  await authorize(actor, eventId, "manageUsers");
  const sq = requireSquare();
  if (sq.environment === "production") throw invalid("Test terminals exist only in Square's sandbox.");
  await addTerminal(eventId, actor.userId, SANDBOX_TEST_DEVICE);
}

export async function removeTerminal(actor: Actor, eventId: string, deviceId: string) {
  await authorize(actor, eventId, "manageUsers");
  const conn = await connectionFor(db, eventId);
  await upsertConnection(eventId, actor.userId, {
    pairedTerminals: (conn?.pairedTerminals ?? []).filter((t) => t.deviceId !== deviceId),
  });
}

/** What the payment screen needs: whether Square is ready and which terminals can be used. */
export async function paymentOptions(actor: Actor, eventId: string) {
  await authorize(actor, eventId, "takePayment");
  const sq = getSquare();
  const conn = await connectionFor(db, eventId);
  return {
    squareReady: !!sq && !!conn?.locationId,
    terminals: sq ? (conn?.pairedTerminals ?? []) : [],
    sandbox: sq?.environment === "sandbox" || sq?.environment === "fake",
  };
}

// ---------- Checkouts ----------

/** True if any of these tickets is part of a card payment still waiting for Square. */
export async function hasOpenCheckout(q: Q, customerIds: string[]): Promise<boolean> {
  if (!customerIds.length) return false;
  const [row] = await q
    .select({ id: checkouts.id })
    .from(checkouts)
    .where(and(eq(checkouts.status, "pending"), sql`${checkouts.customerIds} ?| ${sql.param(customerIds)}::text[]`))
    .limit(1);
  return !!row;
}

function describe(eventName: string, eventYear: number, rows: { ticketType: string }[], groupName: string | null) {
  const seated = rows.filter((r) => r.ticketType === "seated").length;
  const standing = rows.length - seated;
  const parts = [
    seated ? `${seated} seated ticket${seated === 1 ? "" : "s"}` : "",
    standing ? `${standing} standing-room ticket${standing === 1 ? "" : "s"}` : "",
  ].filter(Boolean);
  return `${eventName} ${eventYear}: ${parts.join(" and ")}${groupName ? ` (${groupName})` : ""}`;
}

export type CheckoutStart = { kind: "terminal"; deviceId: string } | { kind: "link"; buyerEmail?: string | null };

/**
 * Starts a card payment. Refused before any money is taken if the tickets aren't unpaid, are
 * already being paid for, or would go over what's left (spec 3.5 and 3.6).
 */
export async function startCheckout(actor: Actor, eventId: string, customerIds: string[], how: CheckoutStart) {
  await authorize(actor, eventId, "takePayment");
  const sq = requireSquare();
  const ids = [...new Set(customerIds)];
  if (!ids.length) throw invalid("Choose the tickets being paid for.");
  const conn = await connectionFor(db, eventId);
  if (!conn?.locationId) throw invalid("An admin needs to choose the Square location in Settings first.");
  if (how.kind === "terminal" && !(conn.pairedTerminals ?? []).some((t) => t.deviceId === how.deviceId)) {
    throw invalid("Choose a paired Square Terminal.");
  }
  if (how.kind === "link" && how.buyerEmail && !isValidEmail(how.buyerEmail)) throw invalid("Enter a valid email address.");

  const [event] = await db.select().from(events).where(eq(events.id, eventId));
  if (!event) throw notFound("The event");

  // Check and record the checkout under the sales lock, then call Square outside it.
  const checkout = await db.transaction(async (tx) => {
    await lockEventSales(tx, eventId);
    const rows = await tx
      .select({ c: customers, groupName: groups.name })
      .from(customers)
      .leftJoin(groups, eq(groups.id, customers.groupId))
      .where(and(eq(customers.eventId, eventId), inArray(customers.id, ids), isNull(customers.deletedAt)));
    if (rows.length !== ids.length) throw notFound("One of those tickets");
    if (rows.some((r) => r.c.paymentStatus !== "unpaid")) throw conflict("Only unpaid tickets can be paid for.");
    if (await hasOpenCheckout(tx, ids)) throw conflict("A card payment is already in progress for these tickets.");
    await assertCanPayFor(
      tx,
      eventId,
      rows.map((r) => r.c),
    );
    const amountCents = rows.reduce((s, r) => s + r.c.priceCents, 0);
    if (amountCents <= 0) throw invalid("These tickets have no price to charge. Mark them complimentary instead.");
    const [row] = await tx
      .insert(checkouts)
      .values({
        eventId,
        kind: how.kind,
        customerIds: ids,
        amountCents,
        currency: event.currency,
        deviceId: how.kind === "terminal" ? how.deviceId : null,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      })
      .returning();
    return { row: row!, note: describe(event.name, new Date(event.date).getFullYear(), rows.map((r) => r.c), rows[0]!.groupName) };
  });

  const { row } = checkout;
  try {
    if (how.kind === "terminal") {
      const t = await sq.createTerminalCheckout({
        idempotencyKey: row.id,
        amount: { amountCents: row.amountCents, currency: row.currency },
        deviceId: how.deviceId,
        referenceId: row.id,
        note: checkout.note,
      });
      await db.update(checkouts).set({ squareCheckoutId: t.id, updatedAt: new Date() }).where(eq(checkouts.id, row.id));
    } else {
      const l = await sq.createPaymentLink({
        idempotencyKey: row.id,
        amount: { amountCents: row.amountCents, currency: row.currency },
        locationId: conn.locationId,
        name: checkout.note,
        note: `Yoculan Seating checkout ${row.id}`,
        buyerEmail: how.buyerEmail || null,
      });
      await db
        .update(checkouts)
        .set({ squareCheckoutId: l.id, squareOrderId: l.orderId, url: l.url, updatedAt: new Date() })
        .where(eq(checkouts.id, row.id));
      if (how.buyerEmail) await emailLink(event.name, how.buyerEmail, l.url, row.amountCents, row.currency, checkout.note);
    }
  } catch (err) {
    // Nothing was charged: close the checkout so the tickets can be paid another way.
    await db
      .update(checkouts)
      .set({ status: "canceled", cancelReason: "Square refused the request", updatedAt: new Date() })
      .where(eq(checkouts.id, row.id));
    squareFailure(err);
  }
  return row.id;
}

async function emailLink(eventName: string, to: string, url: string, amountCents: number, currency: string, what: string) {
  const amount = new Intl.NumberFormat("en", { style: "currency", currency }).format(amountCents / 100);
  await getMailer().send({
    to,
    subject: `Payment for your ${eventName} tickets`,
    text: `Hello,\n\nPlease use this secure Square link to pay ${amount} for ${what}:\n\n${url}\n\nTickets are non-refundable.\n`,
  });
}

export async function emailPaymentLink(actor: Actor, checkoutId: string, to: string) {
  const c = await checkoutFor(actor, checkoutId);
  if (c.kind !== "link" || !c.url || c.status !== "pending") throw invalid("This payment link is no longer open.");
  if (!isValidEmail(to)) throw invalid("Enter a valid email address.");
  const [event] = await db.select().from(events).where(eq(events.id, c.eventId));
  await emailLink(event!.name, to, c.url, c.amountCents, c.currency, `${c.customerIds.length} ticket${c.customerIds.length === 1 ? "" : "s"}`);
}

async function checkoutFor(actor: Actor, checkoutId: string) {
  const [c] = await db.select().from(checkouts).where(eq(checkouts.id, checkoutId));
  if (!c) throw notFound("That payment");
  await authorize(actor, c.eventId, "takePayment");
  return c;
}

export async function getCheckout(actor: Actor, checkoutId: string) {
  const c = await checkoutFor(actor, checkoutId);
  const names = await db
    .select({ id: customers.id, name: customers.name })
    .from(customers)
    .where(inArray(customers.id, c.customerIds));
  return { ...c, names: names.map((n) => n.name) };
}

/**
 * Asks Square for the checkout's outcome and records it. Safe to call repeatedly and from the
 * webhook at the same time: a checkout is completed only once.
 */
export async function syncCheckout(checkoutId: string): Promise<"pending" | "completed" | "canceled"> {
  const [c] = await db.select().from(checkouts).where(eq(checkouts.id, checkoutId));
  if (!c) throw notFound("That payment");
  if (c.status !== "pending" || !c.squareCheckoutId) return c.status;
  const sq = requireSquare();

  let paymentId: string | null = null;
  if (c.kind === "terminal") {
    const t = await sq.getTerminalCheckout(c.squareCheckoutId).catch(squareFailure);
    if (t.status === "CANCELED") {
      await db
        .update(checkouts)
        .set({ status: "canceled", cancelReason: reasonText(t.cancelReason), updatedAt: new Date() })
        .where(and(eq(checkouts.id, c.id), eq(checkouts.status, "pending")));
      return "canceled";
    }
    if (t.status !== "COMPLETED") return "pending";
    paymentId = t.paymentIds[0] ?? null;
  } else {
    const o = await sq.getOrderPaymentState(c.squareOrderId!).catch(squareFailure);
    if (!o.paid) return "pending";
    paymentId = o.completedPaymentIds[0] ?? null;
  }
  await completeCheckout(c.id, paymentId);
  await closeUnpayableLinks(c.eventId);
  return "completed";
}

function reasonText(reason?: string) {
  switch (reason) {
    case "BUYER_CANCELED":
      return "Canceled on the terminal";
    case "SELLER_CANCELED":
      return "Canceled by staff";
    case "TIMED_OUT":
      return "Timed out on the terminal";
    default:
      return reason ? reason.toLowerCase().replace(/_/g, " ") : "Canceled";
  }
}

async function completeCheckout(checkoutId: string, squarePaymentId: string | null) {
  await db.transaction(async (tx) => {
    const [c] = await tx
      .update(checkouts)
      .set({ status: "completed", squarePaymentId, completedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(checkouts.id, checkoutId), eq(checkouts.status, "pending")))
      .returning();
    if (!c) return; // Already recorded by another request.
    await lockEventSales(tx, c.eventId);
    const rows = await tx.select().from(customers).where(inArray(customers.id, c.customerIds));
    const stillUnpaid = rows.filter((r) => !r.deletedAt && r.paymentStatus === "unpaid");
    // The money is taken either way. If tickets ran out meanwhile, flag it for an admin.
    let oversold = stillUnpaid.length !== rows.length;
    try {
      await assertCanPayFor(tx, c.eventId, stillUnpaid);
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
      oversold = true;
    }
    if (oversold) await tx.update(checkouts).set({ oversold: true }).where(eq(checkouts.id, c.id));
    const method = c.kind === "terminal" ? ("square_terminal" as const) : ("square_link" as const);
    for (const r of rows) {
      await tx.insert(payments).values({
        customerId: r.id,
        kind: "payment",
        amountCents: r.priceCents,
        method,
        takenBy: c.createdBy,
        squareReference: squarePaymentId,
        updatedBy: c.createdBy,
      });
    }
    if (stillUnpaid.length) {
      await tx
        .update(customers)
        .set({ paymentStatus: "paid", updatedAt: new Date() })
        .where(inArray(customers.id, stillUnpaid.map((r) => r.id)));
    }
  });
}

export async function cancelCheckout(actor: Actor, checkoutId: string) {
  const c = await checkoutFor(actor, checkoutId);
  if (c.status !== "pending") return;
  // Check first: the buyer may have just paid.
  if ((await syncCheckout(c.id)) !== "pending") return;
  const sq = requireSquare();
  if (c.squareCheckoutId) {
    if (c.kind === "terminal") await sq.cancelTerminalCheckout(c.squareCheckoutId).catch(squareFailure);
    else await sq.deletePaymentLink(c.squareCheckoutId).catch(squareFailure);
  }
  await db
    .update(checkouts)
    .set({ status: "canceled", cancelReason: "Canceled by staff", updatedAt: new Date(), updatedBy: actor.userId })
    .where(and(eq(checkouts.id, c.id), eq(checkouts.status, "pending")));
}

/** Checks every open card payment in the event with Square. Used by the Sales screen. */
export async function syncOpenCheckouts(actor: Actor, eventId: string, limit = 25) {
  await authorize(actor, eventId, "takePayment");
  if (!getSquare()) return;
  const open = await db
    .select({ id: checkouts.id })
    .from(checkouts)
    .where(and(eq(checkouts.eventId, eventId), eq(checkouts.status, "pending")))
    .orderBy(desc(checkouts.createdAt))
    .limit(limit);
  for (const c of open) await syncCheckout(c.id).catch(() => undefined);
}

export async function listOpenCheckouts(actor: Actor, eventId: string) {
  await authorize(actor, eventId, "takePayment");
  return db
    .select()
    .from(checkouts)
    .where(and(eq(checkouts.eventId, eventId), eq(checkouts.status, "pending")))
    .orderBy(desc(checkouts.createdAt));
}

/** Payments taken after tickets ran out. An admin raises capacity or refunds, then resolves. */
export async function listOversold(actor: Actor, eventId: string) {
  await authorize(actor, eventId, "refund");
  return db
    .select()
    .from(checkouts)
    .where(and(eq(checkouts.eventId, eventId), eq(checkouts.oversold, true), isNull(checkouts.oversoldResolvedAt)));
}

export async function resolveOversold(actor: Actor, checkoutId: string) {
  const [c] = await db.select().from(checkouts).where(eq(checkouts.id, checkoutId));
  if (!c) throw notFound("That payment");
  await authorize(actor, c.eventId, "refund");
  await db
    .update(checkouts)
    .set({ oversoldResolvedAt: new Date(), updatedAt: new Date(), updatedBy: actor.userId })
    .where(eq(checkouts.id, checkoutId));
}

/**
 * Once tickets of a type are gone, open payment links for them are closed so nobody pays for a
 * ticket that no longer exists (spec 3.5: payment only while a ticket is available).
 */
export async function closeUnpayableLinks(eventId: string) {
  const sq = getSquare();
  if (!sq) return;
  const cap = await capacityFor(db, eventId);
  if (!cap.seatedSoldOut && !cap.allSoldOut) return;
  const open = await db
    .select()
    .from(checkouts)
    .where(and(eq(checkouts.eventId, eventId), eq(checkouts.status, "pending"), eq(checkouts.kind, "link")));
  for (const c of open) {
    const rows = await db
      .select({ ticketType: customers.ticketType, groupId: customers.groupId })
      .from(customers)
      .where(inArray(customers.id, c.customerIds));
    try {
      await db.transaction(async (tx) => {
        await lockEventSales(tx, eventId);
        await assertCanPayFor(tx, eventId, rows);
      });
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
      if ((await syncCheckout(c.id).catch(() => "pending")) !== "pending") continue;
      await sq.deletePaymentLink(c.squareCheckoutId!).catch(() => undefined);
      await db
        .update(checkouts)
        .set({ status: "canceled", cancelReason: "Tickets sold out", updatedAt: new Date() })
        .where(and(eq(checkouts.id, c.id), eq(checkouts.status, "pending")));
    }
  }
}

// ---------- Cash recorded in Square ----------

/** Records cash payments in Square so all takings are in one place. Failures stay pending for retry. */
export async function recordCashInSquare(eventId: string, paymentIds: string[]) {
  const sq = getSquare();
  if (!sq || !paymentIds.length) return;
  const conn = await connectionFor(db, eventId);
  if (!conn?.locationId) return; // Recorded once a location is chosen.
  const [event] = await db.select().from(events).where(eq(events.id, eventId));
  const rows = await db
    .select({ p: payments, name: customers.name })
    .from(payments)
    .innerJoin(customers, eq(customers.id, payments.customerId))
    .where(and(inArray(payments.id, paymentIds), eq(payments.squarePending, true)));
  for (const { p, name } of rows) {
    try {
      const ref = await sq.recordCashPayment({
        idempotencyKey: p.id,
        amount: { amountCents: p.amountCents, currency: event!.currency },
        locationId: conn.locationId,
        referenceId: p.customerId,
        note: `${event!.name}: cash for ${name}`,
      });
      await db.update(payments).set({ squareReference: ref, squarePending: false }).where(eq(payments.id, p.id));
    } catch (err) {
      console.error("Recording cash in Square failed", err);
    }
  }
}

export async function cashWaitingForSquare(eventId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(payments)
    .innerJoin(customers, eq(customers.id, payments.customerId))
    .where(and(eq(customers.eventId, eventId), eq(payments.squarePending, true)));
  return row?.n ?? 0;
}

export async function retryCashInSquare(actor: Actor, eventId: string) {
  await authorize(actor, eventId, "takePayment");
  const rows = await db
    .select({ id: payments.id })
    .from(payments)
    .innerJoin(customers, eq(customers.id, payments.customerId))
    .where(and(eq(customers.eventId, eventId), eq(payments.squarePending, true)));
  await recordCashInSquare(
    eventId,
    rows.map((r) => r.id),
  );
}

// ---------- Webhook ----------

/**
 * Handles a notification from Square (payment or terminal checkout updated). The body is only
 * used to find which checkout to re-check; the outcome always comes from asking Square directly.
 */
export async function handleSquareWebhook(body: string, signature: string | null): Promise<number> {
  const key = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
  if (!key) return 503;
  if (!verifySquareSignature(body, signature, appUrl("/api/square/webhook"), key)) return 401;
  let event: { data?: { object?: Record<string, { id?: string; order_id?: string }> } };
  try {
    event = JSON.parse(body);
  } catch {
    return 400;
  }
  const obj = event.data?.object ?? {};
  const terminalId = obj.checkout?.id;
  const orderId = obj.payment?.order_id ?? obj.order_updated?.order_id;
  const [c] = await db
    .select({ id: checkouts.id })
    .from(checkouts)
    .where(
      terminalId
        ? eq(checkouts.squareCheckoutId, terminalId)
        : orderId
          ? eq(checkouts.squareOrderId, orderId)
          : sql`false`,
    )
    .limit(1);
  if (c) await syncCheckout(c.id).catch((err) => console.error("Square webhook sync failed", err));
  return 200;
}
