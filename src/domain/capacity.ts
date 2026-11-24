/**
 * Capacity, sell-out and standing room (section 3.6). Every sale and payment goes through
 * here, so the limits are worked out in one place (and a future Eventbrite connection can
 * read seats left from it, section 3.3.1).
 */
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, type Db, type Tx } from "@/db";
import { customers, events, groups, sections, seats, tables } from "@/db/schema";
import { conflict, notFound } from "@/lib/errors";

type Q = Db | Tx;

/** Statuses that count as sold. Unpaid, pending comps and refunds do not. */
export const SOLD_STATUSES = ["paid", "complimentary"] as const;

export interface CapacityState {
  generalSeats: number;
  reservedSeats: number;
  /** True when the general-sale seat count comes from the drawn floor plan, not the typed-in number. */
  fromFloorPlan: boolean;
  standingTickets: number;
  venueCapacity: number;
  warningPercent: number;
  soldGeneralSeated: number;
  soldStanding: number;
  soldTotal: number;
  unpaidOutstanding: number;
  seatedLeft: number;
  standingLeft: number;
  standingOpen: boolean;
  nearlySoldOut: boolean;
  seatedSoldOut: boolean;
  allSoldOut: boolean;
}

/** Pure calculation, kept separate so the rules are easy to test and read. */
export function computeCapacity(input: {
  generalSeats: number;
  reservedSeats: number;
  fromFloorPlan: boolean;
  standingTickets: number;
  venueCapacity: number;
  warningPercent: number;
  soldGeneralSeated: number;
  soldStanding: number;
  soldTotal: number;
  unpaidOutstanding: number;
}): CapacityState {
  const roomLeft = Math.max(0, input.venueCapacity - input.soldTotal);
  const seatedLeft = Math.min(Math.max(0, input.generalSeats - input.soldGeneralSeated), roomLeft);
  const seatedSoldOut = seatedLeft === 0;
  const standingLeft = seatedSoldOut
    ? Math.min(Math.max(0, input.standingTickets - input.soldStanding), roomLeft)
    : 0;
  return {
    ...input,
    seatedLeft,
    standingLeft,
    standingOpen: seatedSoldOut && standingLeft > 0,
    nearlySoldOut: input.generalSeats > 0 && input.soldGeneralSeated > (input.generalSeats * input.warningPercent) / 100,
    seatedSoldOut,
    allSoldOut: seatedSoldOut && standingLeft === 0,
  };
}

export async function capacityFor(q: Q, eventId: string): Promise<CapacityState> {
  const [event] = await q.select().from(events).where(eq(events.id, eventId));
  if (!event) throw notFound("The event");

  const seatRows = await q
    .select({ reserved: sections.reserved, n: sql<number>`count(${seats.id})::int` })
    .from(tables)
    .innerJoin(sections, eq(sections.id, tables.sectionId))
    .leftJoin(seats, eq(seats.tableId, tables.id))
    .where(eq(tables.eventId, eventId))
    .groupBy(sections.reserved);
  const hasTables = seatRows.length > 0;
  const drawnGeneral = seatRows.find((r) => !r.reserved)?.n ?? 0;
  const reservedSeats = seatRows.find((r) => r.reserved)?.n ?? 0;
  const generalSeats = hasTables ? drawnGeneral : (event.generalSeatsOverride ?? 0);

  // A seated ticket counts against general sale unless its group is allocated to a reserved section or sponsor.
  const [counts] = await q
    .select({
      generalSeated: sql<number>`count(*) filter (where ${customers.ticketType} = 'seated' and ${customers.paymentStatus} in ('paid','complimentary') and ${groups.sectionId} is null and ${groups.sponsorId} is null)::int`,
      standing: sql<number>`count(*) filter (where ${customers.ticketType} = 'standing' and ${customers.paymentStatus} in ('paid','complimentary'))::int`,
      total: sql<number>`count(*) filter (where ${customers.paymentStatus} in ('paid','complimentary'))::int`,
      unpaid: sql<number>`count(*) filter (where ${customers.paymentStatus} = 'unpaid')::int`,
    })
    .from(customers)
    .leftJoin(groups, eq(groups.id, customers.groupId))
    .where(and(eq(customers.eventId, eventId), isNull(customers.deletedAt)));

  return computeCapacity({
    generalSeats,
    reservedSeats,
    fromFloorPlan: hasTables,
    standingTickets: event.standingTickets,
    venueCapacity: event.venueCapacity,
    warningPercent: event.sellOutWarningPercent,
    soldGeneralSeated: counts?.generalSeated ?? 0,
    soldStanding: counts?.standing ?? 0,
    soldTotal: counts?.total ?? 0,
    unpaidOutstanding: counts?.unpaid ?? 0,
  });
}

/** Holds a per-event lock for the rest of the transaction, so two sales can't both take the last seat. */
export async function lockEventSales(tx: Tx, eventId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${eventId}))`);
}

/**
 * Throws unless `quantity` more tickets of this type can be sold now. Call inside a
 * transaction after lockEventSales. Reserved-section tickets are not limited by general sale.
 */
export async function assertCanSell(
  tx: Tx,
  eventId: string,
  ticketType: "seated" | "standing",
  quantity: number,
  allocation: "general" | "reserved" = "general",
) {
  const cap = await capacityFor(tx, eventId);
  if (cap.soldTotal + quantity > cap.venueCapacity) {
    throw conflict(`Only ${Math.max(0, cap.venueCapacity - cap.soldTotal)} tickets are left before the venue is full.`);
  }
  if (ticketType === "seated") {
    if (allocation === "reserved") return;
    if (quantity > cap.seatedLeft) {
      const standingNote = cap.standingTickets - cap.soldStanding > 0 ? " Standing room may be offered instead." : "";
      throw conflict(
        cap.seatedLeft === 0
          ? `Seated tickets are sold out.${standingNote}`
          : `Only ${cap.seatedLeft} seated tickets are left.${standingNote}`,
      );
    }
  } else {
    if (!cap.seatedSoldOut) throw conflict("Standing room opens only when seated tickets are sold out.");
    if (quantity > cap.standingLeft) {
      throw conflict(cap.standingLeft === 0 ? "Everything is sold out." : `Only ${cap.standingLeft} standing-room tickets are left.`);
    }
  }
}

/**
 * Throws if a reserved section has no room for `quantity` more sold or comped seats. A section
 * is limited only once its tables are drawn; before the floor plan exists only venue capacity applies.
 */
export async function assertSectionRoom(tx: Tx, sectionId: string, quantity: number) {
  const [row] = await tx
    .select({
      seats: sql<number>`(select count(*)::int from ${seats} s join ${tables} t on t.id = s.table_id where t.section_id = ${sectionId})`,
      tableCount: sql<number>`(select count(*)::int from ${tables} t where t.section_id = ${sectionId})`,
      used: sql<number>`(select count(*)::int from ${customers} c join ${groups} g on g.id = c.group_id
        where g.section_id = ${sectionId} and c.deleted_at is null and c.ticket_type = 'seated'
        and c.payment_status in ('paid','complimentary'))`,
      name: sections.name,
    })
    .from(sections)
    .where(eq(sections.id, sectionId));
  if (!row) throw notFound("The section");
  if (row.tableCount === 0) return;
  if (row.used + quantity > row.seats) {
    throw conflict(`${row.name} is full (${row.used} of ${row.seats} seats used). Add a table to it or use General.`);
  }
}

/**
 * Throws unless these unpaid tickets can be paid for now, under the same rules as a new sale.
 * Call inside a transaction after lockEventSales.
 */
export async function assertCanPayFor(
  tx: Tx,
  eventId: string,
  tickets: { ticketType: "seated" | "standing"; groupId: string | null }[],
) {
  for (const type of ["seated", "standing"] as const) {
    const byGroup = new Map<string | null, number>();
    for (const t of tickets.filter((t) => t.ticketType === type)) byGroup.set(t.groupId, (byGroup.get(t.groupId) ?? 0) + 1);
    for (const [groupId, n] of byGroup) await assertCanSell(tx, eventId, type, n, await allocationOf(tx, groupId));
  }
}

/** Whether a group's allocation is general sale or reserved. */
export async function allocationOf(q: Q, groupId: string | null | undefined): Promise<"general" | "reserved"> {
  if (!groupId) return "general";
  const [g] = await q
    .select({ sectionId: groups.sectionId, sponsorId: groups.sponsorId })
    .from(groups)
    .where(inArray(groups.id, [groupId]));
  return g && (g.sectionId || g.sponsorId) ? "reserved" : "general";
}

export async function getCapacity(eventId: string) {
  return capacityFor(db, eventId);
}
