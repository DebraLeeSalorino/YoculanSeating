"use server";

import { revalidatePath } from "next/cache";
import { updateSettings } from "@/domain/settings";
import { AppError } from "@/lib/errors";
import { requireUser } from "@/lib/session";

export interface SettingsForm {
  name: string;
  /** ISO timestamp, converted from the admin's local time in the browser. */
  date: string;
  timeZone: string;
  defaultCountry: string;
  currency: string;
  seatedPrice: string;
  standingPrice: string;
  generalSeats: string;
  standingTickets: string;
  venueCapacity: string;
  warningPercent: string;
  buyerPageClosesAt: string | null;
}

const cents = (value: string, what: string) => {
  const n = Number(value.replace(/[^0-9.]/g, ""));
  if (value.trim() === "" || !Number.isFinite(n)) throw new AppError("invalid", `Enter ${what}.`);
  return Math.round(n * 100);
};
const int = (value: string) => (value.trim() === "" ? NaN : Number(value));

export async function saveSettingsAction(eventId: string, form: SettingsForm) {
  const user = await requireUser();
  try {
    await updateSettings({ userId: user.id }, eventId, {
      name: form.name,
      date: new Date(form.date),
      timeZone: form.timeZone.trim(),
      defaultCountry: form.defaultCountry.trim().toUpperCase(),
      currency: form.currency.trim().toUpperCase(),
      seatedPriceCents: cents(form.seatedPrice, "the seated price"),
      standingPriceCents: cents(form.standingPrice, "the standing-room price"),
      generalSeatsOverride: form.generalSeats.trim() === "" ? null : int(form.generalSeats),
      standingTickets: int(form.standingTickets),
      venueCapacity: int(form.venueCapacity),
      sellOutWarningPercent: int(form.warningPercent),
      buyerPageClosesAt: form.buyerPageClosesAt ? new Date(form.buyerPageClosesAt) : null,
    });
    revalidatePath(`/e/${eventId}`, "layout");
    return { status: "saved" as const };
  } catch (err) {
    if (err instanceof AppError) return { status: "error" as const, error: err.message };
    throw err;
  }
}
