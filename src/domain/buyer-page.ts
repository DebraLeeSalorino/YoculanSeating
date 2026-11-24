/**
 * The buyer page (section 3.7): a private link where a buyer names their guests, with no account.
 * Seating requests (section 6.7) and seat details are added to this page in later releases.
 */
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { customers, events, orders } from "@/db/schema";
import { invalid, notFound } from "@/lib/errors";
import { formatPhone } from "@/lib/phone";
import { appUrl, getMailer } from "@/lib/mail/mailer";
import { cleanPerson, contactFor } from "./customers";
import { authorize, type Actor } from "./permissions";

export const buyerPagePath = (code: string) => `/b/${code}`;

function eventYear(date: Date) {
  return new Date(date).getFullYear();
}

/** When the buyer can no longer edit: the admin's setting, or the start of the event. */
export function editingClosesAt(event: { date: Date; buyerPageClosesAt: Date | null }): Date {
  return event.buyerPageClosesAt ?? event.date;
}

async function loadOrder(orderId: string) {
  const [row] = await db
    .select({ order: orders, event: events })
    .from(orders)
    .innerJoin(events, eq(events.id, orders.eventId))
    .where(eq(orders.id, orderId));
  if (!row) throw notFound("The order");
  return row;
}

/** Emails the buyer their page link. Failures are logged rather than undoing the sale. */
export async function sendBuyerPageEmail(orderId: string): Promise<boolean> {
  const { order, event } = await loadOrder(orderId);
  if (!order.buyerEmail) return false;
  const many = order.ticketQuantity > 1;
  try {
    await getMailer().send({
      to: order.buyerEmail,
      subject: `Your tickets for ${event.name} ${eventYear(event.date)}`,
      text:
        `Hello ${order.buyerName},\n\n` +
        `Thank you for your ${order.ticketQuantity === 1 ? "ticket" : `${order.ticketQuantity} tickets`} to ${event.name} ${eventYear(event.date)}.\n\n` +
        (many
          ? `Please tell us who is coming with you. You can name your guests and add their contact details here:\n\n`
          : `You can check your ticket details here:\n\n`) +
        `${appUrl(buyerPagePath(order.buyerPageCode))}\n\n` +
        `This link is private to you. Tickets are non-refundable.\n`,
    });
    return true;
  } catch (err) {
    console.error("Buyer page email failed", err);
    return false;
  }
}

async function orderForCustomer(actor: Actor, customerId: string) {
  const [row] = await db
    .select({ order: orders })
    .from(customers)
    .innerJoin(orders, eq(orders.id, customers.orderId))
    .where(eq(customers.id, customerId));
  if (!row) throw notFound("The order");
  await authorize(actor, row.order.eventId, "editCustomers");
  return row.order;
}

/** For the "Copy link" button. */
export async function buyerPageLinkFor(actor: Actor, customerId: string): Promise<string> {
  const order = await orderForCustomer(actor, customerId);
  return appUrl(buyerPagePath(order.buyerPageCode));
}

export async function resendBuyerPage(actor: Actor, customerId: string): Promise<void> {
  const order = await orderForCustomer(actor, customerId);
  if (!order.buyerEmail) throw invalid("This order has no buyer email. Copy the link and send it another way.");
  if (!(await sendBuyerPageEmail(order.id))) throw invalid("The email could not be sent. Try again later.");
}

export interface BuyerTicket {
  id: string;
  position: number;
  isBuyer: boolean;
  name: string;
  isPlaceholder: boolean;
  phone: string;
  email: string;
  ticketType: "seated" | "standing";
  refunded: boolean;
}

/** Public: everything the buyer page shows. No staff-only details. */
export async function loadBuyerPage(code: string) {
  const [row] = await db
    .select({ order: orders, event: events })
    .from(orders)
    .innerJoin(events, eq(events.id, orders.eventId))
    .where(eq(orders.buyerPageCode, code));
  if (!row) return null;
  const { order, event } = row;
  const rows = await db
    .select()
    .from(customers)
    .where(and(eq(customers.orderId, order.id), isNull(customers.deletedAt)))
    .orderBy(asc(customers.orderPosition), asc(customers.id));
  const placeholder = `Guest of ${order.buyerName}`;
  const closesAt = editingClosesAt(event);
  const tickets: BuyerTicket[] = rows.map((c, i) => ({
    id: c.id,
    position: i + 1,
    isBuyer: i === 0,
    name: c.name === placeholder ? "" : c.name,
    isPlaceholder: c.name === placeholder,
    phone: formatPhone(c.phone, event.defaultCountry),
    email: c.email ?? "",
    ticketType: c.ticketType,
    refunded: c.paymentStatus === "refunded",
  }));
  return {
    eventName: event.name,
    eventDate: event.date,
    eventYear: eventYear(event.date),
    timeZone: event.timeZone,
    buyerName: order.buyerName,
    placeholder,
    closesAt,
    editable: new Date() < closesAt,
    tickets,
  };
}

export interface GuestDetails {
  customerId: string;
  name: string;
  phone?: string;
  email?: string;
}

/**
 * Public: the buyer saves their guests' details. Only the order's additional tickets can be
 * changed, and only until editing closes. A blank name stays "Guest of [buyer]".
 */
export async function saveGuests(code: string, guests: GuestDetails[]): Promise<void> {
  const [row] = await db
    .select({ order: orders, event: events })
    .from(orders)
    .innerJoin(events, eq(events.id, orders.eventId))
    .where(eq(orders.buyerPageCode, code));
  if (!row) throw notFound("This page");
  const { order, event } = row;
  if (new Date() >= editingClosesAt(event)) throw invalid("Guest details can no longer be changed online. Please contact the organisers.");

  const rows = await db
    .select()
    .from(customers)
    .where(and(eq(customers.orderId, order.id), isNull(customers.deletedAt)))
    .orderBy(asc(customers.orderPosition), asc(customers.id));
  const editable = new Map(rows.slice(1).filter((c) => c.paymentStatus !== "refunded").map((c) => [c.id, c]));
  const placeholder = `Guest of ${order.buyerName}`;

  const cleaned = guests.map((g) => {
    if (!editable.has(g.customerId)) throw invalid("One of those tickets can't be changed here.");
    return { id: g.customerId, person: cleanPerson(g, event.defaultCountry, placeholder) };
  });

  await db.transaction(async (tx) => {
    for (const { id, person } of cleaned) {
      const contactId = await contactFor(tx, person, null);
      await tx
        .update(customers)
        .set({
          name: person.name,
          phone: person.phone,
          email: person.email,
          contactId: contactId ?? editable.get(id)!.contactId,
          updatedAt: new Date(),
          updatedBy: null,
        })
        .where(eq(customers.id, id));
    }
  });
}
