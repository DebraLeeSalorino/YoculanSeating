/**
 * Event settings: prices, limits and capacity (sections 3.5, 3.6 and 9).
 */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { events } from "@/db/schema";
import { invalid } from "@/lib/errors";
import { capacityFor, lockEventSales } from "./capacity";
import { authorize, type Actor } from "./permissions";

export interface EventSettings {
  name: string;
  date: Date;
  timeZone: string;
  defaultCountry: string;
  currency: string;
  seatedPriceCents: number;
  standingPriceCents: number;
  /** Seats on general sale, typed in until the floor plan is drawn. */
  generalSeatsOverride: number | null;
  standingTickets: number;
  venueCapacity: number;
  sellOutWarningPercent: number;
  /** Null means editing closes when the event starts. */
  buyerPageClosesAt: Date | null;
}

export function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return tz.length > 0;
  } catch {
    return false;
  }
}

const whole = (n: number, what: string, min = 0, max = 1_000_000) => {
  if (!Number.isInteger(n) || n < min || n > max) throw invalid(`Enter a whole number for ${what}.`);
  return n;
};

export async function updateSettings(actor: Actor, eventId: string, input: EventSettings) {
  await authorize(actor, eventId, "manageEvent");
  const name = input.name.trim();
  if (!name) throw invalid("Enter the event name.");
  if (!(input.date instanceof Date) || isNaN(input.date.getTime())) throw invalid("Enter the event date.");
  if (!isTimeZone(input.timeZone)) throw invalid("Choose the venue's time zone.");
  if (!/^[A-Z]{2}$/.test(input.defaultCountry)) throw invalid("Choose a country.");
  if (!/^[A-Z]{3}$/.test(input.currency)) throw invalid("Choose a currency.");
  whole(input.seatedPriceCents, "the seated price");
  whole(input.standingPriceCents, "the standing-room price");
  if (input.generalSeatsOverride !== null) whole(input.generalSeatsOverride, "seats on general sale");
  whole(input.standingTickets, "standing-room tickets");
  whole(input.venueCapacity, "venue capacity", 1);
  whole(input.sellOutWarningPercent, "the warning percentage", 1, 100);

  await db.transaction(async (tx) => {
    await lockEventSales(tx, eventId);
    const cap = await capacityFor(tx, eventId);
    const generalSeats = cap.fromFloorPlan ? cap.generalSeats : (input.generalSeatsOverride ?? 0);
    if (input.venueCapacity < cap.soldTotal) {
      throw invalid(`Venue capacity can't be lower than the ${cap.soldTotal} tickets already sold.`);
    }
    if (!cap.fromFloorPlan && generalSeats < cap.soldGeneralSeated) {
      throw invalid(`Seats on general sale can't be lower than the ${cap.soldGeneralSeated} seated tickets already sold.`);
    }
    if (input.standingTickets < cap.soldStanding) {
      throw invalid(`Standing-room tickets can't be lower than the ${cap.soldStanding} already sold.`);
    }
    const total = generalSeats + cap.reservedSeats + input.standingTickets;
    if (total > input.venueCapacity) {
      throw invalid(
        `Seats on general sale (${generalSeats}), reserved seats (${cap.reservedSeats}) and standing room ` +
          `(${input.standingTickets}) add up to ${total}, more than the venue capacity of ${input.venueCapacity}.`,
      );
    }
    await tx
      .update(events)
      .set({
        name,
        date: input.date,
        timeZone: input.timeZone,
        defaultCountry: input.defaultCountry,
        currency: input.currency,
        seatedPriceCents: input.seatedPriceCents,
        standingPriceCents: input.standingPriceCents,
        generalSeatsOverride: input.generalSeatsOverride,
        standingTickets: input.standingTickets,
        venueCapacity: input.venueCapacity,
        sellOutWarningPercent: input.sellOutWarningPercent,
        buyerPageClosesAt: input.buyerPageClosesAt,
        updatedAt: new Date(),
        updatedBy: actor.userId,
      })
      .where(eq(events.id, eventId));
  });
}
