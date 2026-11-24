"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { DuplicateMatch } from "@/domain/customers";
import { saleAction } from "../actions";

export function EventbriteForm({
  eventId,
  seatedPrice,
  standingPrice,
  currency,
}: {
  eventId: string;
  seatedPrice: number;
  standingPrice: number;
  currency: string;
}) {
  const router = useRouter();
  const [orderNumber, setOrderNumber] = useState("");
  const [buyer, setBuyer] = useState({ name: "", email: "", phone: "" });
  const [ticketType, setTicketType] = useState<"seated" | "standing">("seated");
  const [quantity, setQuantity] = useState(1);
  const [guests, setGuests] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<DuplicateMatch[] | null>(null);
  const [pending, startTransition] = useTransition();

  const money = new Intl.NumberFormat(undefined, { style: "currency", currency });
  const price = ticketType === "seated" ? seatedPrice : standingPrice;
  const guestCount = Math.max(0, quantity - 1);

  function submit(confirmDuplicates: boolean) {
    setError(null);
    startTransition(async () => {
      const people = [
        buyer,
        ...Array.from({ length: guestCount }, (_, i) => ({ name: guests[i] ?? "" })),
      ];
      const result = await saleAction(eventId, {
        ticketType,
        payment: "eventbrite",
        eventbriteOrderNumber: orderNumber,
        people,
        confirmDuplicates,
      });
      if (result.status === "error") setError(result.error);
      else if (result.status === "duplicate") setDuplicates(result.matches);
      else router.push(`/e/${eventId}/customers`);
    });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit(false);
      }}
    >
      {error && <div className="notice error" role="alert">{error}</div>}
      {duplicates && (
        <div className="notice warn" role="alert">
          {duplicates.map((d) => (
            <div key={d.customerId + d.kind}>
              {d.kind === "eventbrite_order"
                ? `Order ${d.value} has already been entered, for `
                : "This email is already used by "}
              <Link href={`/e/${eventId}/customers/${d.customerId}`}>{d.customerName}</Link>.
            </div>
          ))}
          <div style={{ marginTop: "0.5rem" }}>
            <button type="button" onClick={() => submit(true)} disabled={pending}>Save anyway</button>{" "}
            <button type="button" className="secondary" onClick={() => setDuplicates(null)}>Cancel</button>
          </div>
        </div>
      )}
      <div className="row">
        <div className="field">
          <label htmlFor="eb-order">Eventbrite order number (optional)</label>
          <input id="eb-order" value={orderNumber} onChange={(e) => setOrderNumber(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="eb-type">Ticket type</label>
          <select id="eb-type" value={ticketType} onChange={(e) => setTicketType(e.target.value as "seated" | "standing")}>
            <option value="seated">Seated</option>
            <option value="standing">Standing room</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="eb-qty">Number of tickets</label>
          <input
            id="eb-qty"
            type="number"
            min={1}
            max={50}
            value={quantity}
            onChange={(e) => setQuantity(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
          />
        </div>
      </div>
      <h2>Buyer (first ticket)</h2>
      <div className="row">
        <div className="field">
          <label htmlFor="eb-name">Name</label>
          <input id="eb-name" required maxLength={120} value={buyer.name} onChange={(e) => setBuyer({ ...buyer, name: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="eb-email">Email</label>
          <input id="eb-email" type="email" value={buyer.email} onChange={(e) => setBuyer({ ...buyer, email: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="eb-phone">Phone</label>
          <input id="eb-phone" inputMode="tel" value={buyer.phone} onChange={(e) => setBuyer({ ...buyer, phone: e.target.value })} />
        </div>
      </div>
      {guestCount > 0 && (
        <>
          <h2>Other ticket holders</h2>
          {Array.from({ length: guestCount }, (_, i) => (
            <div className="field" key={i}>
              <label htmlFor={`eb-guest-${i}`}>Ticket {i + 2}</label>
              <input
                id={`eb-guest-${i}`}
                maxLength={120}
                placeholder={buyer.name ? `Guest of ${buyer.name}` : "Guest of the buyer"}
                value={guests[i] ?? ""}
                onChange={(e) => {
                  const next = [...guests];
                  next[i] = e.target.value;
                  setGuests(next);
                }}
              />
            </div>
          ))}
        </>
      )}
      <p>
        {quantity} × {money.format(price / 100)} = <strong>{money.format((quantity * price) / 100)}</strong>, paid on
        Eventbrite.
      </p>
      <button type="submit" disabled={pending}>{pending ? "Saving…" : "Save order"}</button>{" "}
      <Link href={`/e/${eventId}/customers`}>Cancel</Link>
    </form>
  );
}
