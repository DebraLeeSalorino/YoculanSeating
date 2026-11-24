/**
 * Sales totals by seller and by channel, and the unpaid-tickets list (sections 3.5 and 9.1).
 * Admins see everyone's totals; a ticket seller sees only their own.
 */
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { customers, groups, orders, payments, users } from "@/db/schema";
import { authorize, can, type Actor } from "./permissions";

export interface SalesTotals {
  key: string;
  label: string;
  seatedSold: number;
  standingSold: number;
  paidCents: number;
  unpaidCents: number;
  unpaidCount: number;
  compCount: number;
  compValueCents: number;
  pendingCompCount: number;
  refundedCents: number;
}

const METHOD_LABELS: Record<string, string> = {
  cash: "Cash",
  eventbrite: "Eventbrite",
  square_terminal: "Square terminal",
  square_link: "Square payment link",
};

function empty(key: string, label: string): SalesTotals {
  return {
    key,
    label,
    seatedSold: 0,
    standingSold: 0,
    paidCents: 0,
    unpaidCents: 0,
    unpaidCount: 0,
    compCount: 0,
    compValueCents: 0,
    pendingCompCount: 0,
    refundedCents: 0,
  };
}

export async function salesTotals(actor: Actor, eventId: string) {
  const role = await authorize(actor, eventId, "seeOwnSalesTotals");
  const everyone = can(role, "seeAllSalesTotals");

  const rows = await db
    .select({
      id: customers.id,
      deleted: customers.deletedAt,
      ticketType: customers.ticketType,
      status: customers.paymentStatus,
      priceCents: customers.priceCents,
      soldBy: customers.soldBy,
      sellerName: users.name,
      channel: orders.channel,
    })
    .from(customers)
    .leftJoin(users, eq(users.id, customers.soldBy))
    .leftJoin(orders, eq(orders.id, customers.orderId))
    .where(eq(customers.eventId, eventId));
  const pays = await db
    .select({ customerId: payments.customerId, kind: payments.kind, amountCents: payments.amountCents, method: payments.method })
    .from(payments)
    .innerJoin(customers, eq(customers.id, payments.customerId))
    .where(eq(customers.eventId, eventId));

  const sellerKey = (r: (typeof rows)[number]) => (r.channel === "eventbrite" ? "eventbrite" : (r.soldBy ?? "unknown"));
  const visible = rows.filter((r) => everyone || r.soldBy === actor.userId);
  const visibleIds = new Set(visible.map((r) => r.id));
  const byCustomer = new Map(rows.map((r) => [r.id, r]));

  const bySeller = new Map<string, SalesTotals>();
  const sellerRow = (r: (typeof rows)[number]) => {
    const key = sellerKey(r);
    if (!bySeller.has(key)) bySeller.set(key, empty(key, key === "eventbrite" ? "Eventbrite" : (r.sellerName ?? "Unknown")));
    return bySeller.get(key)!;
  };
  for (const r of visible) {
    const t = sellerRow(r);
    if (r.deleted) continue;
    const sold = r.status === "paid" || r.status === "complimentary";
    if (sold && r.ticketType === "seated") t.seatedSold++;
    if (sold && r.ticketType === "standing") t.standingSold++;
    if (r.status === "unpaid") {
      t.unpaidCount++;
      t.unpaidCents += r.priceCents;
    }
    if (r.status === "complimentary") {
      t.compCount++;
      t.compValueCents += r.priceCents;
    }
    if (r.status === "comp_pending") t.pendingCompCount++;
  }

  const byChannel = new Map<string, SalesTotals>();
  for (const p of pays) {
    if (!visibleIds.has(p.customerId)) continue;
    const seller = sellerRow(byCustomer.get(p.customerId)!);
    if (!byChannel.has(p.method)) byChannel.set(p.method, empty(p.method, METHOD_LABELS[p.method] ?? p.method));
    const channel = byChannel.get(p.method)!;
    for (const t of [seller, channel]) {
      if (p.kind === "payment") t.paidCents += p.amountCents;
      else t.refundedCents += p.amountCents;
    }
    // A ticket sold through this channel and still held.
    const c = byCustomer.get(p.customerId)!;
    if (p.kind === "payment" && c.status === "paid" && !c.deleted) {
      if (c.ticketType === "seated") channel.seatedSold++;
      else channel.standingSold++;
    }
  }

  const sellers = [...bySeller.values()].sort((a, b) => a.label.localeCompare(b.label));
  const total = sellers.reduce((acc, t) => {
    for (const k of Object.keys(acc) as (keyof SalesTotals)[]) {
      if (typeof acc[k] === "number") (acc[k] as number) += t[k] as number;
    }
    return acc;
  }, empty("total", everyone ? "All sellers" : "Your total"));
  return { everyone, sellers, channels: [...byChannel.values()], total };
}

export async function listUnpaid(actor: Actor, eventId: string) {
  await authorize(actor, eventId, "takePayment");
  return db
    .select({
      id: customers.id,
      name: customers.name,
      groupId: customers.groupId,
      groupName: groups.name,
      ticketType: customers.ticketType,
      amountDueCents: customers.priceCents,
      sellerName: users.name,
    })
    .from(customers)
    .leftJoin(groups, eq(groups.id, customers.groupId))
    .leftJoin(users, eq(users.id, customers.soldBy))
    .where(and(eq(customers.eventId, eventId), isNull(customers.deletedAt), eq(customers.paymentStatus, "unpaid")))
    .orderBy(asc(groups.name), asc(customers.name));
}
