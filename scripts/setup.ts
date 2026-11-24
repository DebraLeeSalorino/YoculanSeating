/**
 * One-time setup: creates the first admin account and the first event.
 *
 *   npm run setup -- --name "Debra" --email you@example.org --event "Gala 2027" --date 2027-11-13
 *
 * Prints a link to choose a password. Run once per new installation.
 */
import { parseArgs } from "node:util";
import { sql } from "drizzle-orm";
import { db, pool } from "../src/db";
import { authTokens, users } from "../src/db/schema";
import { createEvent } from "../src/domain/events";
import { hashToken, newToken } from "../src/lib/auth/tokens";
import { appUrl } from "../src/lib/mail/mailer";

const { values } = parseArgs({
  options: {
    name: { type: "string" },
    email: { type: "string" },
    event: { type: "string" },
    date: { type: "string" },
    country: { type: "string", default: "US" },
    seats: { type: "string" },
  },
});

if (!values.name || !values.email || !values.event || !values.date) {
  console.error('Usage: npm run setup -- --name "Your Name" --email you@example.org --event "Event name" --date YYYY-MM-DD [--country US] [--seats 1200]');
  process.exit(1);
}

let [user] = await db.select().from(users).where(sql`lower(${users.email}) = ${values.email.toLowerCase()}`);
if (!user) [user] = await db.insert(users).values({ name: values.name, email: values.email }).returning();

const event = await createEvent(user!.id, {
  name: values.event,
  date: new Date(`${values.date}T18:00:00`),
  defaultCountry: values.country,
  generalSeatsOverride: values.seats ? Number(values.seats) : null,
});

const token = newToken();
await db.insert(authTokens).values({
  kind: "invite",
  userId: user!.id,
  tokenHash: hashToken(token),
  expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
});

console.log(`Created event "${event.name}" with ${values.name} as its admin.`);
console.log(`Choose a password here (works once, for 7 days):\n  ${appUrl(`/invite/${token}`)}`);
await pool.end();
