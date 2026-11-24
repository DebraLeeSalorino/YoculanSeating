/**
 * Customers, orders and recording a sale (sections 3.1, 3.2, 3.3 and 3.5).
 *
 * In this slice a sale is saved as Unpaid, paid in cash, or (admins only) entered as an
 * Eventbrite order. Square charging is added in a later slice.
 */
import { and, asc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { db, type Tx } from "@/db";
import {
  assignments,
  contacts,
  customers,
  events,
  groups,
  orders,
  payments,
  seats,
  tables,
} from "@/db/schema";
import { invalid, notFound, conflict } from "@/lib/errors";
import { newToken } from "@/lib/auth/tokens";
import { formatPhone, normalisePhone } from "@/lib/phone";
import { allocationOf, assertCanSell, lockEventSales } from "./capacity";
import { refreshGroup, uniqueAutoName } from "./groups";
import { authorize, can, type Actor } from "./permissions";
import { isValidEmail } from "./users";

export type SalePayment = "unpaid" | "cash" | "eventbrite";

export interface PersonInput {
  name: string;
  phone?: string | null;
  email?: string | null;
  notes?: string | null;
}

export interface SaleInput {
  ticketType: "seated" | "standing";
  /** Required: a seller must choose (acceptance criterion in section 12). */
  payment: SalePayment | null | undefined;
  /** One entry per ticket. For Eventbrite orders, names after the first may be blank. */
  people: PersonInput[];
  /** Add to an existing group instead of starting a new one. */
  groupId?: string | null;
  /** A typed group name for a new group. Blank means automatic. */
  groupName?: string | null;
  eventbriteOrderNumber?: string | null;
  /** Admin-only price override, in cents, per ticket. */
  priceCents?: number | null;
  /** Set after the user has seen the duplicate warning and chosen to save anyway. */
  confirmDuplicates?: boolean;
}

export interface DuplicateMatch {
  kind: "email" | "eventbrite_order";
  value: string;
  customerId: string;
  customerName: string;
}

export type SaleResult =
  | { status: "created"; orderId: string; groupId: string; customerIds: string[] }
  | { status: "duplicate"; matches: DuplicateMatch[] };

interface CleanPerson {
  name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
}

function cleanPerson(p: PersonInput, defaultCountry: string, fallbackName?: string): CleanPerson {
  const name = (p.name ?? "").trim() || fallbackName || "";
  if (!name) throw invalid("Enter a name.");
  if (name.length > 120) throw invalid("Names can be at most 120 characters.");
  const email = (p.email ?? "").trim() || null;
  if (email && !isValidEmail(email)) throw invalid(`"${email}" is not a valid email address.`);
  const rawPhone = (p.phone ?? "").trim();
  let phone: string | null = null;
  if (rawPhone) {
    phone = normalisePhone(rawPhone, defaultCountry);
    if (!phone) throw invalid(`"${rawPhone}" is not a valid phone number.`);
  }
  const notes = (p.notes ?? "").trim() || null;
  return { name, phone, email, notes };
}

async function loadEvent(eventId: string) {
  const [event] = await db.select().from(events).where(eq(events.id, eventId));
  if (!event) throw notFound("The event");
  return event;
}

/** Customers in the event with the same email, ignoring case. */
async function emailMatches(eventId: string, emails: string[], excludeCustomerId?: string): Promise<DuplicateMatch[]> {
  const lower = [...new Set(emails.map((e) => e.toLowerCase()))];
  if (lower.length === 0) return [];
  const rows = await db
    .select({ id: customers.id, name: customers.name, email: customers.email })
    .from(customers)
    .where(
      and(
        eq(customers.eventId, eventId),
        isNull(customers.deletedAt),
        inArray(sql`lower(${customers.email})`, lower),
      ),
    );
  return rows
    .filter((r) => r.id !== excludeCustomerId)
    .map((r) => ({ kind: "email" as const, value: r.email!, customerId: r.id, customerName: r.name }));
}

/** Finds the person's contact record across years by email, then phone; creates one if none. */
async function contactFor(tx: Tx, p: CleanPerson, actorId: string): Promise<string> {
  const conditions = [];
  if (p.email) conditions.push(sql`lower(${contacts.email}) = ${p.email.toLowerCase()}`);
  if (p.phone) conditions.push(eq(contacts.phone, p.phone));
  if (conditions.length) {
    const [found] = await tx
      .select({ id: contacts.id })
      .from(contacts)
      .where(or(...conditions))
      .limit(1);
    if (found) return found.id;
  }
  const [created] = await tx
    .insert(contacts)
    .values({ name: p.name, email: p.email, phone: p.phone, updatedBy: actorId })
    .returning({ id: contacts.id });
  return created!.id;
}

export async function createSale(actor: Actor, eventId: string, input: SaleInput): Promise<SaleResult> {
  const role = await authorize(actor, eventId, "editCustomers");
  const event = await loadEvent(eventId);

  if (input.payment !== "unpaid" && input.payment !== "cash" && input.payment !== "eventbrite") {
    throw invalid("Choose whether the tickets are paid or unpaid.");
  }
  if (input.payment === "eventbrite") await authorize(actor, eventId, "enterEventbriteOrders");
  if (input.ticketType !== "seated" && input.ticketType !== "standing") throw invalid("Choose a ticket type.");
  if (!input.people?.length) throw invalid("Add at least one ticket.");
  if (input.people.length > 200) throw invalid("That is more tickets than one order can hold.");

  let priceCents = input.ticketType === "seated" ? event.seatedPriceCents : event.standingPriceCents;
  if (input.priceCents != null) {
    if (!can(role, "refund")) throw invalid("Only an admin can change a ticket's price.");
    if (!Number.isInteger(input.priceCents) || input.priceCents < 0) throw invalid("Enter a valid price.");
    priceCents = input.priceCents;
  }

  const isEventbrite = input.payment === "eventbrite";
  const buyer = cleanPerson(input.people[0]!, event.defaultCountry);
  const people = input.people.map((p, i) =>
    i === 0 ? buyer : cleanPerson(p, event.defaultCountry, isEventbrite ? `Guest of ${buyer.name}` : undefined),
  );
  const orderNumber = isEventbrite ? (input.eventbriteOrderNumber ?? "").trim() || null : null;

  if (input.groupId) {
    const [g] = await db.select({ eventId: groups.eventId }).from(groups).where(eq(groups.id, input.groupId));
    if (!g || g.eventId !== eventId) throw notFound("The group");
  }

  if (!input.confirmDuplicates) {
    const matches = await emailMatches(
      eventId,
      people.map((p) => p.email).filter((e): e is string => !!e),
    );
    if (orderNumber) {
      const rows = await db
        .select({ id: customers.id, name: customers.name })
        .from(orders)
        .innerJoin(customers, eq(customers.orderId, orders.id))
        .where(and(eq(orders.eventId, eventId), eq(orders.eventbriteOrderNumber, orderNumber)))
        .limit(1);
      for (const r of rows) {
        matches.push({ kind: "eventbrite_order", value: orderNumber, customerId: r.id, customerName: r.name });
      }
    }
    if (matches.length) return { status: "duplicate", matches };
  }

  const paid = input.payment !== "unpaid";
  return db.transaction(async (tx) => {
    await lockEventSales(tx, eventId);
    if (input.ticketType === "standing") {
      // Standing room is offered only once seated tickets are gone, paid or not.
      await assertCanSell(tx, eventId, "standing", paid ? people.length : 0);
    }
    if (paid && input.ticketType === "seated") {
      await assertCanSell(tx, eventId, "seated", people.length, await allocationOf(tx, input.groupId));
    }

    const [order] = await tx
      .insert(orders)
      .values({
        eventId,
        channel: isEventbrite ? "eventbrite" : "app",
        eventbriteOrderNumber: orderNumber,
        buyerName: buyer.name,
        buyerEmail: buyer.email,
        buyerPhone: buyer.phone,
        ticketQuantity: people.length,
        ticketType: input.ticketType,
        soldBy: isEventbrite ? null : actor.userId,
        buyerPageCode: newToken(24),
        updatedBy: actor.userId,
      })
      .returning({ id: orders.id });

    let groupId = input.groupId ?? null;
    if (!groupId) {
      const typed = (input.groupName ?? "").trim();
      const [group] = await tx
        .insert(groups)
        .values({
          eventId,
          name: typed || (await uniqueAutoName(tx, eventId, buyer.name)),
          nameIsAutomatic: !typed,
          updatedBy: actor.userId,
        })
        .returning({ id: groups.id });
      groupId = group!.id;
    }

    const customerIds: string[] = [];
    for (const p of people) {
      const [c] = await tx
        .insert(customers)
        .values({
          eventId,
          contactId: await contactFor(tx, p, actor.userId),
          orderId: order!.id,
          groupId,
          name: p.name,
          phone: p.phone,
          email: p.email,
          notes: p.notes,
          ticketType: input.ticketType,
          priceCents,
          paymentStatus: paid ? "paid" : "unpaid",
          soldBy: isEventbrite ? null : actor.userId,
          ticketCode: newToken(18),
          updatedBy: actor.userId,
        })
        .returning({ id: customers.id });
      customerIds.push(c!.id);
      if (paid) {
        await tx.insert(payments).values({
          customerId: c!.id,
          kind: "payment",
          amountCents: priceCents,
          method: isEventbrite ? "eventbrite" : "cash",
          takenBy: actor.userId,
          updatedBy: actor.userId,
        });
      }
    }
    return { status: "created" as const, orderId: order!.id, groupId: groupId!, customerIds };
  });
}

/** Records cash for unpaid tickets. Refused before any money changes hands if tickets have run out. */
export async function takeCashPayment(actor: Actor, eventId: string, customerIds: string[]) {
  await authorize(actor, eventId, "takePayment");
  if (!customerIds.length) throw invalid("Choose the tickets being paid for.");
  await db.transaction(async (tx) => {
    await lockEventSales(tx, eventId);
    const rows = await tx
      .select()
      .from(customers)
      .where(and(eq(customers.eventId, eventId), inArray(customers.id, customerIds), isNull(customers.deletedAt)));
    if (rows.length !== customerIds.length) throw notFound("One of those tickets");
    if (rows.some((r) => r.paymentStatus !== "unpaid")) throw conflict("Only unpaid tickets can be paid for.");
    for (const type of ["seated", "standing"] as const) {
      const ofType = rows.filter((r) => r.ticketType === type);
      if (!ofType.length) continue;
      // Tickets in one call share a group in practice; check each group's allocation.
      const byGroup = new Map<string | null, number>();
      for (const r of ofType) byGroup.set(r.groupId, (byGroup.get(r.groupId) ?? 0) + 1);
      for (const [groupId, n] of byGroup) await assertCanSell(tx, eventId, type, n, await allocationOf(tx, groupId));
    }
    for (const r of rows) {
      await tx.insert(payments).values({
        customerId: r.id,
        kind: "payment",
        amountCents: r.priceCents,
        method: "cash",
        takenBy: actor.userId,
        updatedBy: actor.userId,
      });
      await tx
        .update(customers)
        .set({ paymentStatus: "paid", updatedAt: new Date(), updatedBy: actor.userId })
        .where(eq(customers.id, r.id));
    }
  });
}

export interface CustomerEdit extends PersonInput {
  confirmDuplicates?: boolean;
}

export async function updateCustomer(
  actor: Actor,
  customerId: string,
  input: CustomerEdit,
): Promise<{ status: "saved" } | { status: "duplicate"; matches: DuplicateMatch[] }> {
  const [existing] = await db.select().from(customers).where(eq(customers.id, customerId));
  if (!existing || existing.deletedAt) throw notFound("The customer");
  await authorize(actor, existing.eventId, "editCustomers");
  const event = await loadEvent(existing.eventId);
  const p = cleanPerson(input, event.defaultCountry);

  const emailChanged = (p.email ?? "").toLowerCase() !== (existing.email ?? "").toLowerCase();
  if (p.email && emailChanged && !input.confirmDuplicates) {
    const matches = await emailMatches(existing.eventId, [p.email], customerId);
    if (matches.length) return { status: "duplicate", matches };
  }

  await db.transaction(async (tx) => {
    await tx
      .update(customers)
      .set({ name: p.name, phone: p.phone, email: p.email, notes: p.notes, updatedAt: new Date(), updatedBy: actor.userId })
      .where(eq(customers.id, customerId));
    if (existing.contactId && (p.email || p.phone)) {
      await tx
        .update(contacts)
        .set({
          name: p.name,
          ...(p.email ? { email: p.email } : {}),
          ...(p.phone ? { phone: p.phone } : {}),
          updatedAt: new Date(),
          updatedBy: actor.userId,
        })
        .where(eq(contacts.id, existing.contactId));
    }
    if (existing.groupId && existing.name !== p.name) await refreshGroup(tx, existing.groupId);
  });
  return { status: "saved" };
}

/**
 * Deletes a customer (admins only). Their seat is freed and the rest of the group stays seated.
 * The row is kept, marked deleted, because payment records must never be removed.
 */
export async function deleteCustomer(actor: Actor, customerId: string) {
  const [existing] = await db.select().from(customers).where(eq(customers.id, customerId));
  if (!existing || existing.deletedAt) throw notFound("The customer");
  await authorize(actor, existing.eventId, "deleteCustomers");
  await db.transaction(async (tx) => {
    await tx.delete(assignments).where(eq(assignments.customerId, customerId));
    await tx
      .update(customers)
      .set({ deletedAt: new Date(), groupId: null, updatedAt: new Date(), updatedBy: actor.userId })
      .where(eq(customers.id, customerId));
    if (existing.groupId) await refreshGroup(tx, existing.groupId);
  });
}

export interface CustomerRow {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  groupId: string | null;
  groupName: string | null;
  ticketType: "seated" | "standing";
  paymentStatus: string;
  priceCents: number;
  seat: string | null;
  channel: "app" | "eventbrite" | null;
  eventbriteOrderNumber: string | null;
}

export async function listCustomers(
  actor: Actor,
  eventId: string,
  opts: { search?: string; filter?: "all" | "seated" | "waiting" | "unpaid" } = {},
): Promise<CustomerRow[]> {
  const role = await authorize(actor, eventId, "editCustomers");
  const event = await loadEvent(eventId);
  const showContact = can(role, "seeContactDetails");

  const conditions = [eq(customers.eventId, eventId), isNull(customers.deletedAt)];
  const search = (opts.search ?? "").trim();
  if (search) {
    const like = `%${search.replace(/[%_\\]/g, (c) => "\\" + c)}%`;
    const digits = search.replace(/\D/g, "");
    const searchConds = [ilike(customers.name, like), ilike(groups.name, like)];
    if (showContact) {
      searchConds.push(ilike(customers.email, like));
      if (digits.length >= 3) searchConds.push(ilike(customers.phone, `%${digits}%`));
    }
    conditions.push(or(...searchConds)!);
  }
  if (opts.filter === "seated") conditions.push(sql`${assignments.id} is not null`);
  if (opts.filter === "waiting") conditions.push(sql`${assignments.id} is null and ${customers.ticketType} = 'seated'`);
  if (opts.filter === "unpaid") conditions.push(eq(customers.paymentStatus, "unpaid"));

  const rows = await db
    .select({
      id: customers.id,
      name: customers.name,
      phone: customers.phone,
      email: customers.email,
      notes: customers.notes,
      groupId: customers.groupId,
      groupName: groups.name,
      ticketType: customers.ticketType,
      paymentStatus: customers.paymentStatus,
      priceCents: customers.priceCents,
      tableLabel: tables.label,
      seatNumber: seats.number,
      channel: orders.channel,
      eventbriteOrderNumber: orders.eventbriteOrderNumber,
    })
    .from(customers)
    .leftJoin(groups, eq(groups.id, customers.groupId))
    .leftJoin(orders, eq(orders.id, customers.orderId))
    .leftJoin(assignments, eq(assignments.customerId, customers.id))
    .leftJoin(seats, eq(seats.id, assignments.seatId))
    .leftJoin(tables, eq(tables.id, seats.tableId))
    .where(and(...conditions))
    .orderBy(asc(sql`lower(${customers.name})`), asc(customers.createdAt))
    .limit(2500);

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    phone: showContact ? formatPhone(r.phone, event.defaultCountry) || null : null,
    email: showContact ? r.email : null,
    notes: r.notes,
    groupId: r.groupId,
    groupName: r.groupName,
    ticketType: r.ticketType,
    paymentStatus: r.paymentStatus,
    priceCents: r.priceCents,
    seat: r.tableLabel != null ? `Table ${r.tableLabel}, Seat ${r.seatNumber}` : null,
    channel: r.channel,
    eventbriteOrderNumber: r.eventbriteOrderNumber,
  }));
}

export async function getCustomer(actor: Actor, customerId: string) {
  const [c] = await db.select().from(customers).where(eq(customers.id, customerId));
  if (!c || c.deletedAt) throw notFound("The customer");
  const role = await authorize(actor, c.eventId, "editCustomers");
  const event = await loadEvent(c.eventId);
  const showContact = can(role, "seeContactDetails");
  return {
    ...c,
    phone: showContact ? c.phone : null,
    phoneDisplay: showContact ? formatPhone(c.phone, event.defaultCountry) : "",
    email: showContact ? c.email : null,
  };
}
