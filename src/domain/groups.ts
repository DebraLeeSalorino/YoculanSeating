/**
 * Group naming (section 4). Fuller group actions (merge, split, dissolve) come with the
 * groups screen in a later slice.
 */
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db, type Db, type Tx } from "@/db";
import { customers, groups } from "@/db/schema";
import { invalid, notFound } from "@/lib/errors";
import { authorize, type Actor } from "./permissions";

type Q = Db | Tx;

/** "Maria Rivera" -> "Rivera", "Guest of Maria Rivera" -> "Rivera", "Cher" -> "Cher". */
export function lastNameOf(fullName: string): string {
  const base = fullName.replace(/^guest of\s+/i, "").trim();
  const words = base.split(/\s+/).filter(Boolean);
  return words[words.length - 1] ?? "Guest";
}

/** Picks "<Name> party", or "<Name> party 2", 3, ... if taken in the event. */
export async function uniqueAutoName(q: Q, eventId: string, firstMemberName: string, excludeGroupId?: string) {
  const base = `${lastNameOf(firstMemberName)} party`;
  const rows = await q
    .select({ id: groups.id, name: groups.name })
    .from(groups)
    .where(and(eq(groups.eventId, eventId), sql`lower(${groups.name}) like ${base.toLowerCase() + "%"}`));
  const taken = new Set(rows.filter((r) => r.id !== excludeGroupId).map((r) => r.name.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base} ${n}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

export async function firstMember(q: Q, groupId: string) {
  const [first] = await q
    .select({ id: customers.id, name: customers.name })
    .from(customers)
    .where(and(eq(customers.groupId, groupId), isNull(customers.deletedAt)))
    .orderBy(asc(customers.createdAt), asc(customers.id))
    .limit(1);
  return first;
}

/**
 * Call after a group's membership changes. Deletes the group when it has no members left,
 * and updates an automatic name when the first member has changed.
 */
export async function refreshGroup(q: Q, groupId: string) {
  const [group] = await q.select().from(groups).where(eq(groups.id, groupId));
  if (!group) return;
  const first = await firstMember(q, groupId);
  if (!first) {
    await q.delete(groups).where(eq(groups.id, groupId));
    return;
  }
  if (!group.nameIsAutomatic) return;
  const expectedBase = `${lastNameOf(first.name)} party`;
  if (group.name === expectedBase || group.name.startsWith(expectedBase + " ")) return;
  const name = await uniqueAutoName(q, group.eventId, first.name, groupId);
  await q.update(groups).set({ name, updatedAt: new Date() }).where(eq(groups.id, groupId));
}

/** Sets a typed name, or returns the group to its automatic name when the name is blank. */
export async function renameGroup(actor: Actor, groupId: string, name: string | null) {
  const [group] = await db.select().from(groups).where(eq(groups.id, groupId));
  if (!group) throw notFound("The group");
  await authorize(actor, group.eventId, "editCustomers");
  const typed = (name ?? "").trim();
  if (typed.length > 120) throw invalid("Keep group names to 120 characters.");
  if (typed) {
    await db
      .update(groups)
      .set({ name: typed, nameIsAutomatic: false, updatedAt: new Date(), updatedBy: actor.userId })
      .where(eq(groups.id, groupId));
    return;
  }
  const first = await firstMember(db, groupId);
  const auto = await uniqueAutoName(db, group.eventId, first?.name ?? "Guest", groupId);
  await db
    .update(groups)
    .set({ name: auto, nameIsAutomatic: true, updatedAt: new Date(), updatedBy: actor.userId })
    .where(eq(groups.id, groupId));
}

export async function listGroups(actor: Actor, eventId: string) {
  await authorize(actor, eventId, "editCustomers");
  return db
    .select({
      id: groups.id,
      name: groups.name,
      size: sql<number>`(select count(*)::int from customers c where c.group_id = ${groups.id} and c.deleted_at is null)`,
    })
    .from(groups)
    .where(eq(groups.eventId, eventId))
    .orderBy(asc(groups.name));
}
