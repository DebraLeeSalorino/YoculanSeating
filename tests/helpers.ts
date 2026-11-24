import { db } from "@/db";
import { memberships, users } from "@/db/schema";
import { createEvent, type NewEvent } from "@/domain/events";
import type { Role } from "@/domain/permissions";
import { hashPassword } from "@/lib/auth/password";
import { getMailer, MemoryMailer } from "@/lib/mail/mailer";

export const PASSWORD = "correct horse battery";

export function mailer(): MemoryMailer {
  return getMailer() as MemoryMailer;
}

let counter = 0;

export async function makeUser(name = "Test User", withPassword = true) {
  counter++;
  const [user] = await db
    .insert(users)
    .values({
      name,
      email: `user${counter}-${Date.now()}@example.org`,
      passwordHash: withPassword ? await hashPassword(PASSWORD) : null,
    })
    .returning();
  return user!;
}

/** An event with an admin, a ticket seller and a door staff member. */
export async function makeEvent(overrides: Partial<NewEvent> = {}) {
  const admin = await makeUser("Ada Admin");
  const event = await createEvent(admin.id, {
    name: "Gala",
    date: new Date("2027-11-13T18:00:00Z"),
    seatedPriceCents: 10000,
    standingPriceCents: 5000,
    generalSeatsOverride: 200,
    standingTickets: 20,
    ...overrides,
  });
  const seller = await addMember(event.id, "Sam Seller", "ticket_seller");
  const door = await addMember(event.id, "Dee Door", "door_staff");
  return { event, admin, seller, door };
}

export async function addMember(eventId: string, name: string, role: Role) {
  const user = await makeUser(name);
  await db.insert(memberships).values({ eventId, userId: user.id, role });
  return user;
}

export const as = (user: { id: string }) => ({ userId: user.id });

/** Pulls the path of the first app link out of an email body. */
export function linkPath(text: string): string {
  const match = text.match(/https?:\/\/[^\s]+(\/(invite|reset)\/[A-Za-z0-9_-]+)/);
  if (!match) throw new Error(`No link found in: ${text}`);
  return match[1]!;
}
