import { eq } from "drizzle-orm";
import { db } from "@/db";
import { events, memberships, sections } from "@/db/schema";
import { invalid, notFound } from "@/lib/errors";
import { requireMember, type Actor } from "./permissions";

/** The four sections every event starts with (section 5.6). */
export const DEFAULT_SECTIONS = [
  { name: "General", colour: "#4f7cac", reserved: false },
  { name: "Sponsors", colour: "#c9a227", reserved: true },
  { name: "Seller friends and family", colour: "#5b9e6f", reserved: true },
  { name: "Committee friends and family", colour: "#9a6bb5", reserved: true },
];

export interface NewEvent {
  name: string;
  date: Date;
  defaultCountry?: string;
  currency?: string;
  seatedPriceCents?: number;
  standingPriceCents?: number;
  generalSeatsOverride?: number | null;
  standingTickets?: number;
  venueCapacity?: number;
}

/** Creates an event with its default sections and makes `adminUserId` its first admin. */
export async function createEvent(adminUserId: string, input: NewEvent) {
  if (!input.name.trim()) throw invalid("Enter the event name.");
  return db.transaction(async (tx) => {
    const [event] = await tx
      .insert(events)
      .values({
        name: input.name.trim(),
        date: input.date,
        defaultCountry: input.defaultCountry ?? "US",
        currency: input.currency ?? "USD",
        seatedPriceCents: input.seatedPriceCents ?? 0,
        standingPriceCents: input.standingPriceCents ?? 0,
        generalSeatsOverride: input.generalSeatsOverride ?? null,
        standingTickets: input.standingTickets ?? 0,
        venueCapacity: input.venueCapacity ?? 1400,
        updatedBy: adminUserId,
      })
      .returning();
    await tx.insert(sections).values(DEFAULT_SECTIONS.map((s) => ({ ...s, eventId: event!.id, updatedBy: adminUserId })));
    await tx.insert(memberships).values({ eventId: event!.id, userId: adminUserId, role: "admin", updatedBy: adminUserId });
    return event!;
  });
}

export async function getEvent(actor: Actor, eventId: string) {
  const role = await requireMember(actor, eventId);
  const [event] = await db.select().from(events).where(eq(events.id, eventId));
  if (!event) throw notFound("The event");
  return { event, role };
}
