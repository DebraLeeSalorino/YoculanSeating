"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { saveSettingsAction, type SettingsForm } from "./actions";

/** "2027-11-13T18:00:00.000Z" -> "2027-11-13T13:00" in the browser's own time zone. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export interface SettingsInitial {
  name: string;
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
  seatsFromFloorPlan: boolean;
  reservedSeats: number;
}

export function SettingsFormView({ eventId, initial }: { eventId: string; initial: SettingsInitial }) {
  const router = useRouter();
  const [f, setF] = useState({ ...initial, date: "", buyerPageClosesAt: "" });
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  // Dates are shown in the admin's own time zone, which is only known in the browser.
  // A venue time zone that was never set defaults to the admin's own.
  useEffect(() => {
    setF((prev) => ({
      ...prev,
      date: toLocalInput(initial.date),
      buyerPageClosesAt: toLocalInput(initial.buyerPageClosesAt),
      timeZone: initial.timeZone === "UTC" ? Intl.DateTimeFormat().resolvedOptions().timeZone : initial.timeZone,
    }));
  }, [initial.date, initial.buyerPageClosesAt, initial.timeZone]);

  const set = (key: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF({ ...f, [key]: e.target.value });

  function save(e: React.FormEvent) {
    e.preventDefault();
    if (!f.date) {
      setMessage({ kind: "error", text: "Enter the event date and time." });
      return;
    }
    const payload: SettingsForm = {
      name: f.name,
      date: new Date(f.date).toISOString(),
      timeZone: f.timeZone,
      defaultCountry: f.defaultCountry,
      currency: f.currency,
      seatedPrice: f.seatedPrice,
      standingPrice: f.standingPrice,
      generalSeats: f.generalSeats,
      standingTickets: f.standingTickets,
      venueCapacity: f.venueCapacity,
      warningPercent: f.warningPercent,
      buyerPageClosesAt: f.buyerPageClosesAt ? new Date(f.buyerPageClosesAt).toISOString() : null,
    };
    startTransition(async () => {
      const r = await saveSettingsAction(eventId, payload);
      setMessage(r.status === "error" ? { kind: "error", text: r.error } : { kind: "ok", text: "Settings saved. Limits and warnings are updated." });
      router.refresh();
    });
  }

  return (
    <form className="card" onSubmit={save} style={{ maxWidth: 760 }}>
      {message && <div className={`notice ${message.kind}`} role={message.kind === "error" ? "alert" : "status"}>{message.text}</div>}
      <h2 style={{ marginTop: 0 }}>Event</h2>
      <div className="row">
        <div className="field" style={{ flexBasis: "260px" }}>
          <label htmlFor="s-name">Event name</label>
          <input id="s-name" required value={f.name} onChange={set("name")} />
        </div>
        <div className="field">
          <label htmlFor="s-date">Starts (your local time)</label>
          <input id="s-date" type="datetime-local" required value={f.date} onChange={set("date")} />
        </div>
        <div className="field">
          <label htmlFor="s-tz">Venue time zone</label>
          <input id="s-tz" value={f.timeZone} onChange={set("timeZone")} placeholder="America/New_York" />
        </div>
      </div>
      <div className="row">
        <div className="field">
          <label htmlFor="s-country">Country for phone numbers</label>
          <input id="s-country" maxLength={2} value={f.defaultCountry} onChange={set("defaultCountry")} placeholder="US" />
        </div>
        <div className="field">
          <label htmlFor="s-currency">Currency</label>
          <input id="s-currency" maxLength={3} value={f.currency} onChange={set("currency")} placeholder="USD" />
        </div>
      </div>

      <h2>Ticket prices</h2>
      <div className="row">
        <div className="field">
          <label htmlFor="s-seated">Seated ticket</label>
          <input id="s-seated" inputMode="decimal" value={f.seatedPrice} onChange={set("seatedPrice")} />
        </div>
        <div className="field">
          <label htmlFor="s-standing">Standing-room ticket</label>
          <input id="s-standing" inputMode="decimal" value={f.standingPrice} onChange={set("standingPrice")} />
        </div>
      </div>

      <h2>Limits</h2>
      <div className="row">
        <div className="field">
          <label htmlFor="s-capacity">Venue capacity (people)</label>
          <input id="s-capacity" type="number" min={1} value={f.venueCapacity} onChange={set("venueCapacity")} />
        </div>
        <div className="field">
          <label htmlFor="s-general">Seats on general sale</label>
          <input
            id="s-general"
            type="number"
            min={0}
            value={f.generalSeats}
            onChange={set("generalSeats")}
            disabled={initial.seatsFromFloorPlan}
          />
        </div>
        <div className="field">
          <label htmlFor="s-standing-count">Standing-room tickets</label>
          <input id="s-standing-count" type="number" min={0} value={f.standingTickets} onChange={set("standingTickets")} />
        </div>
        <div className="field">
          <label htmlFor="s-warn">Nearly-sold-out warning at (%)</label>
          <input id="s-warn" type="number" min={1} max={100} value={f.warningPercent} onChange={set("warningPercent")} />
        </div>
      </div>
      <p className="muted" style={{ fontSize: "0.9rem" }}>
        {initial.seatsFromFloorPlan
          ? "Seats on general sale now come from the floor plan."
          : "Seats on general sale is typed in until the floor plan is drawn."}{" "}
        General seats, {initial.reservedSeats} reserved seats and standing room together can't exceed venue capacity.
        Standing room opens only when seated tickets sell out; zero means none are sold.
      </p>

      <h2>Buyer page</h2>
      <div className="field" style={{ maxWidth: 320 }}>
        <label htmlFor="s-close">Buyers can edit guest details until (blank: when the event starts)</label>
        <input id="s-close" type="datetime-local" value={f.buyerPageClosesAt} onChange={set("buyerPageClosesAt")} />
      </div>
      <button type="submit" disabled={pending}>{pending ? "Saving…" : "Save settings"}</button>
    </form>
  );
}
