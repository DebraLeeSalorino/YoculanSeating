import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";

/** Returns the number in international E.164 form, or null if it is not a valid number. */
export function normalisePhone(input: string, defaultCountry: string): string | null {
  const parsed = parsePhoneNumberFromString(input.trim(), defaultCountry as CountryCode);
  if (!parsed || !parsed.isValid()) return null;
  return parsed.number;
}

/** Shows a stored number in local format when it is from the event's country, otherwise international. */
export function formatPhone(e164: string | null | undefined, defaultCountry: string): string {
  if (!e164) return "";
  const parsed = parsePhoneNumberFromString(e164);
  if (!parsed) return e164;
  return parsed.country === defaultCountry ? parsed.formatNational() : parsed.formatInternational();
}
