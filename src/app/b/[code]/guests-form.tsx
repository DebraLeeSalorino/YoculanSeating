"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { BuyerTicket } from "@/domain/buyer-page";
import { saveGuestsAction } from "./actions";

export function GuestsForm({ code, tickets, placeholder }: { code: string; tickets: BuyerTicket[]; placeholder: string }) {
  const router = useRouter();
  const editable = tickets.filter((t) => !t.isBuyer && !t.refunded);
  const [values, setValues] = useState(() =>
    Object.fromEntries(editable.map((t) => [t.id, { name: t.name, phone: t.phone, email: t.email }])),
  );
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const update = (id: string, key: "name" | "phone" | "email", value: string) =>
    setValues({ ...values, [id]: { ...values[id]!, [key]: value } });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const r = await saveGuestsAction(
            code,
            editable.map((t) => ({ customerId: t.id, ...values[t.id]! })),
          );
          setMessage(r.status === "error" ? { kind: "error", text: r.error } : { kind: "ok", text: "Thank you. Your guests' details are saved." });
          router.refresh();
        });
      }}
    >
      {message && <div className={`notice ${message.kind}`} role="status">{message.text}</div>}
      {editable.map((t) => (
        <fieldset key={t.id} className="card" style={{ marginBottom: "0.75rem" }}>
          <legend style={{ fontWeight: 600 }}>
            Ticket {t.position}
            {t.ticketType === "standing" ? " (standing room)" : ""}
          </legend>
          <div className="field">
            <label htmlFor={`g-${t.id}-name`}>Guest's name</label>
            <input
              id={`g-${t.id}-name`}
              maxLength={120}
              placeholder={placeholder}
              value={values[t.id]!.name}
              onChange={(e) => update(t.id, "name", e.target.value)}
            />
          </div>
          <div className="row">
            <div className="field">
              <label htmlFor={`g-${t.id}-email`}>Email (optional)</label>
              <input id={`g-${t.id}-email`} type="email" value={values[t.id]!.email} onChange={(e) => update(t.id, "email", e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor={`g-${t.id}-phone`}>Phone (optional)</label>
              <input id={`g-${t.id}-phone`} inputMode="tel" value={values[t.id]!.phone} onChange={(e) => update(t.id, "phone", e.target.value)} />
            </div>
          </div>
        </fieldset>
      ))}
      <button type="submit" disabled={pending}>{pending ? "Saving…" : "Save guest details"}</button>
    </form>
  );
}
