"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { buyerLinkAction, compUnpaidAction, refundAction, resendBuyerLinkAction } from "../../sales/actions";

interface Props {
  eventId: string;
  customerId: string;
  canRefund: boolean;
  isPaid: boolean;
  /** Unpaid tickets in this customer's group, for an admin comp. */
  unpaidGroupIds: string[];
  canComp: boolean;
  sections: { id: string; name: string }[];
  hasOrder: boolean;
  hasBuyerEmail: boolean;
}

export function TicketActions(p: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [refundOpen, setRefundOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [compOpen, setCompOpen] = useState(false);
  const [compSection, setCompSection] = useState("");
  const [hostName, setHostName] = useState("");

  const run = (fn: () => Promise<{ status: "saved"; message?: string } | { status: "error"; error: string }>, ok: string) =>
    startTransition(async () => {
      const r = await fn();
      setMessage(r.status === "error" ? { kind: "error", text: r.error } : { kind: "ok", text: r.message && ok === "" ? r.message : ok });
      router.refresh();
    });

  return (
    <div className="card" style={{ marginTop: "1rem" }}>
      <h2 style={{ marginTop: 0 }}>Ticket</h2>
      {message && <div className={`notice ${message.kind}`} role="status">{message.text}</div>}
      <div className="row">
        {p.hasOrder && (
          <div className="shrink">
            <button
              type="button"
              className="secondary"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const r = await buyerLinkAction(p.eventId, p.customerId);
                  if (r.status === "error") return setMessage({ kind: "error", text: r.error });
                  try {
                    await navigator.clipboard.writeText(r.message ?? "");
                    setMessage({ kind: "ok", text: "Buyer page link copied." });
                  } catch {
                    setMessage({ kind: "ok", text: `Buyer page link: ${r.message}` });
                  }
                })
              }
            >
              Copy buyer page link
            </button>
          </div>
        )}
        {p.hasOrder && p.hasBuyerEmail && (
          <div className="shrink">
            <button type="button" className="secondary" disabled={pending} onClick={() => run(() => resendBuyerLinkAction(p.eventId, p.customerId), "Buyer page link emailed.")}>
              Email buyer page link
            </button>
          </div>
        )}
        {p.canComp && p.unpaidGroupIds.length > 0 && (
          <div className="shrink">
            <button type="button" className="secondary" disabled={pending} onClick={() => setCompOpen(!compOpen)}>
              Comp {p.unpaidGroupIds.length === 1 ? "this ticket" : `the group's ${p.unpaidGroupIds.length} unpaid tickets`}
            </button>
          </div>
        )}
        {p.canRefund && p.isPaid && (
          <div className="shrink">
            <button type="button" className="danger" disabled={pending} onClick={() => setRefundOpen(!refundOpen)}>
              Refund…
            </button>
          </div>
        )}
      </div>

      {compOpen && (
        <form
          style={{ marginTop: "1rem" }}
          onSubmit={(e) => {
            e.preventDefault();
            run(() => compUnpaidAction(p.eventId, p.unpaidGroupIds, compSection || null, hostName), "Marked complimentary.");
            setCompOpen(false);
          }}
        >
          <div className="row">
            <div>
              <label htmlFor="comp-section">Section</label>
              <select id="comp-section" value={compSection} onChange={(e) => setCompSection(e.target.value)}>
                <option value="">General</option>
                {p.sections.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="comp-host">Whose guests (optional)</label>
              <input id="comp-host" value={hostName} onChange={(e) => setHostName(e.target.value)} />
            </div>
            <div className="shrink">
              <button type="submit" disabled={pending}>Mark complimentary</button>
            </div>
          </div>
        </form>
      )}

      {refundOpen && (
        <form
          style={{ marginTop: "1rem" }}
          onSubmit={(e) => {
            e.preventDefault();
            if (!confirm("Refund this ticket? The customer loses their seat and the ticket goes back on sale.")) return;
            run(() => refundAction(p.eventId, [p.customerId], reason), "Refund recorded.");
            setRefundOpen(false);
          }}
        >
          <p className="muted" style={{ marginTop: 0 }}>
            Tickets are non-refundable; refund only to correct an error. Cash is handed back; an Eventbrite order must
            also be refunded in Eventbrite.
          </p>
          <div className="row">
            <div style={{ flexBasis: "320px" }}>
              <label htmlFor="refund-reason">Reason (required)</label>
              <input id="refund-reason" required value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
            <div className="shrink">
              <button type="submit" className="danger" disabled={pending}>Record refund</button>
            </div>
          </div>
        </form>
      )}
    </div>
  );
}
