"use server";

import { saveGuests, type GuestDetails } from "@/domain/buyer-page";
import { AppError } from "@/lib/errors";

/** Public: no sign-in. The private code in the link is the only key. */
export async function saveGuestsAction(code: string, guests: GuestDetails[]) {
  try {
    await saveGuests(code, guests);
    return { status: "saved" as const };
  } catch (err) {
    if (err instanceof AppError) return { status: "error" as const, error: err.message };
    throw err;
  }
}
