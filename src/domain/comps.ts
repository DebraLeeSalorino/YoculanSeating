/**
 * Complimentary tickets (section 3.5). Seller comps wait for an admin; admin comps don't.
 */
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { customers, groups, sections, users } from "@/db/schema";
import { conflict, invalid, notFound } from "@/lib/errors";
import { assertCanSell, assertSectionRoom, lockEventSales } from "./capacity";
import { authorize, can, type Actor } from "./permissions";

export interface PendingComp {
  groupId: string | null;
  groupName: string | null;
  sellerName: string | null;
  hostName: string | null;
  customers: { id: string; name: string; ticketType: "seated" | "standing" }[];
}

/** Admins see every pending comp; a ticket seller sees their own. */
export async function listPendingComps(actor: Actor, eventId: string): Promise<PendingComp[]> {
  const role = await authorize(actor, eventId, "compFriendsAndFamily");
  const conditions = [
    eq(customers.eventId, eventId),
    isNull(customers.deletedAt),
    eq(customers.paymentStatus, "comp_pending"),
  ];
  if (!can(role, "approveComps")) conditions.push(eq(customers.compGivenBy, actor.userId));
  const rows = await db
    .select({
      id: customers.id,
      name: customers.name,
      ticketType: customers.ticketType,
      groupId: customers.groupId,
      groupName: groups.name,
      hostName: groups.hostName,
      sellerName: users.name,
    })
    .from(customers)
    .leftJoin(groups, eq(groups.id, customers.groupId))
    .leftJoin(users, eq(users.id, customers.compGivenBy))
    .where(and(...conditions))
    .orderBy(asc(customers.createdAt), asc(customers.id));

  const byGroup = new Map<string, PendingComp>();
  for (const r of rows) {
    const key = r.groupId ?? r.id;
    if (!byGroup.has(key)) {
      byGroup.set(key, { groupId: r.groupId, groupName: r.groupName, sellerName: r.sellerName, hostName: r.hostName, customers: [] });
    }
    byGroup.get(key)!.customers.push({ id: r.id, name: r.name, ticketType: r.ticketType });
  }
  return [...byGroup.values()];
}

async function pendingRows(eventId: string, customerIds: string[]) {
  if (!customerIds.length) throw invalid("Choose the tickets.");
  const rows = await db
    .select({ customer: customers, group: groups })
    .from(customers)
    .leftJoin(groups, eq(groups.id, customers.groupId))
    .where(and(eq(customers.eventId, eventId), inArray(customers.id, customerIds), isNull(customers.deletedAt)));
  if (rows.length !== customerIds.length) throw notFound("One of those tickets");
  if (rows.some((r) => r.customer.paymentStatus !== "comp_pending")) {
    throw conflict("Only pending comps can be approved or declined.");
  }
  return rows;
}

/** An admin approves pending comps. Refused if their section or the venue is already full. */
export async function approveComps(actor: Actor, eventId: string, customerIds: string[]) {
  await authorize(actor, eventId, "approveComps");
  await db.transaction(async (tx) => {
    await lockEventSales(tx, eventId);
    const rows = await pendingRows(eventId, customerIds);
    for (const type of ["seated", "standing"] as const) {
      const ofType = rows.filter((r) => r.customer.ticketType === type);
      if (!ofType.length) continue;
      const bySection = new Map<string | null, number>();
      for (const r of ofType) {
        const s = r.group?.sectionId ?? null;
        bySection.set(s, (bySection.get(s) ?? 0) + 1);
      }
      for (const [sectionId, n] of bySection) {
        await assertCanSell(tx, eventId, type, n, sectionId ? "reserved" : "general");
        if (sectionId && type === "seated") await assertSectionRoom(tx, sectionId, n);
      }
    }
    await tx
      .update(customers)
      .set({ paymentStatus: "complimentary", compApprovedBy: actor.userId, updatedAt: new Date(), updatedBy: actor.userId })
      .where(inArray(customers.id, customerIds));
  });
}

/**
 * An admin declines pending comps: the tickets become Unpaid, so the seller can take payment or
 * ask an admin to cancel them. A paying guest belongs in General, so the group moves there.
 */
export async function declineComps(actor: Actor, eventId: string, customerIds: string[]) {
  await authorize(actor, eventId, "approveComps");
  const rows = await pendingRows(eventId, customerIds);
  await db.transaction(async (tx) => {
    await tx
      .update(customers)
      .set({ paymentStatus: "unpaid", compApprovedBy: null, updatedAt: new Date(), updatedBy: actor.userId })
      .where(inArray(customers.id, customerIds));
    const groupIds = [...new Set(rows.map((r) => r.customer.groupId).filter((g): g is string => !!g))];
    for (const groupId of groupIds) {
      // Only move the group if nobody left in it is still a comp.
      const [left] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(customers)
        .where(
          and(
            eq(customers.groupId, groupId),
            isNull(customers.deletedAt),
            inArray(customers.paymentStatus, ["complimentary", "comp_pending"]),
          ),
        );
      if ((left?.n ?? 0) === 0) {
        await tx.update(groups).set({ sectionId: null, updatedAt: new Date(), updatedBy: actor.userId }).where(eq(groups.id, groupId));
      }
    }
  });
}

/** An admin turns unpaid tickets into comps, e.g. sponsor or committee guests (section 3.5). */
export async function compUnpaidTickets(
  actor: Actor,
  eventId: string,
  customerIds: string[],
  opts: { sectionId: string | null; hostName?: string | null },
) {
  await authorize(actor, eventId, "compAny");
  if (!customerIds.length) throw invalid("Choose the tickets.");
  let sectionId = opts.sectionId;
  if (sectionId) {
    const [s] = await db.select().from(sections).where(eq(sections.id, sectionId));
    if (!s || s.eventId !== eventId) throw notFound("The section");
    if (!s.reserved) sectionId = null;
  }
  await db.transaction(async (tx) => {
    await lockEventSales(tx, eventId);
    const rows = await tx
      .select()
      .from(customers)
      .where(and(eq(customers.eventId, eventId), inArray(customers.id, customerIds), isNull(customers.deletedAt)));
    if (rows.length !== customerIds.length) throw notFound("One of those tickets");
    if (rows.some((r) => r.paymentStatus !== "unpaid")) throw conflict("Only unpaid tickets can be comped.");
    const groupIds = new Set(rows.map((r) => r.groupId));
    if (groupIds.size !== 1 || !rows[0]!.groupId) throw invalid("Comp one group at a time.");
    const groupId = rows[0]!.groupId;
    const [groupSize] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(customers)
      .where(and(eq(customers.groupId, groupId), isNull(customers.deletedAt)));
    if (sectionId && groupSize!.n !== rows.length) {
      throw invalid("To move a group into a reserved section, comp every ticket in it.");
    }
    for (const type of ["seated", "standing"] as const) {
      const n = rows.filter((r) => r.ticketType === type).length;
      if (!n) continue;
      await assertCanSell(tx, eventId, type, n, sectionId ? "reserved" : "general");
      if (sectionId && type === "seated") await assertSectionRoom(tx, sectionId, n);
    }
    await tx
      .update(groups)
      .set({ sectionId, hostName: (opts.hostName ?? "").trim() || null, updatedAt: new Date(), updatedBy: actor.userId })
      .where(eq(groups.id, groupId));
    await tx
      .update(customers)
      .set({
        paymentStatus: "complimentary",
        compGivenBy: actor.userId,
        compApprovedBy: actor.userId,
        updatedAt: new Date(),
        updatedBy: actor.userId,
      })
      .where(inArray(customers.id, customerIds));
  });
}

export async function listSections(actor: Actor, eventId: string) {
  await authorize(actor, eventId, "editCustomers");
  return db.select().from(sections).where(eq(sections.eventId, eventId)).orderBy(asc(sections.createdAt), asc(sections.name));
}
