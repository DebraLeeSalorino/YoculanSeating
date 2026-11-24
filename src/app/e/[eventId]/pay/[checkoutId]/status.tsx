"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { cancelCheckoutAction, emailLinkAction, pollCheckoutAction } from "../actions";

interface Props {
  eventId: string;
  checkoutId: string;
  kind: "terminal" | "link";
  initialState: "pending" | "completed" | "canceled";
  url: string | null;
  qrSvg: string | null;
  cancelReason: string | null;
}

/** Waits for Square to confirm the payment, checking every few seconds while the screen is open. */
export function CheckoutStatus(p: Props) {
  const [state, setState] = useState(p.initialState);
  const [reason, setReason] = useState(p.cancelReason);
  const [oversold, setOversold] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (state !== "pending") return;
    let stopped = false;
    const tick = async () => {
      const r = await pollCheckoutAction(p.eventId, p.checkoutId);
      if (stopped) return;
      if (r.status === "error") setError(r.error);
      else {
        setError(null);
        setState(r.state);
        setReason(r.cancelReason);
        setOversold(r.oversold);
      }
    };
    const timer = setInterval(tick, 3000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [state, p.eventId, p.checkoutId]);

  if (state === "completed") {
    return (
      <div className="notice ok" role="status" style={{ fontSize: "1.1rem" }}>
        <strong>Paid.</strong> Square confirmed the payment and the tickets are marked Paid.
        {oversold && <div style={{ marginTop: "0.5rem" }}>Tickets had run out before this payment arrived. Admins have been shown it to resolve.</div>}
        <div style={{ marginTop: "0.75rem" }}>
          <Link className="button" href={`/e/${p.eventId}/sales`}>Done</Link>
        </div>
      </div>
    );
  }
  if (state === "canceled") {
    return (
      <div className="notice warn" role="status">
        <strong>Not paid.</strong> {reason ?? "The payment was canceled."} The tickets are still Unpaid.
        <div style={{ marginTop: "0.75rem" }}>
          <Link className="button secondary" href={`/e/${p.eventId}/sales`}>Back to Sales</Link>
        </div>
      </div>
    );
  }

  return (
    <>
      {error && <div className="notice error" role="alert">{error}</div>}
      <div className="notice warn" role="status" aria-live="polite">
        {p.kind === "terminal"
          ? "Waiting for the buyer to pay on the terminal…"
          : "Waiting for the buyer to pay on Square's page. You can leave this screen; the payment is recorded when it arrives."}
      </div>
      {p.kind === "link" && p.url && (
        <div className="card" style={{ marginBottom: "1rem" }}>
          {p.qrSvg && (
            <div
              aria-label="Payment code to scan"
              role="img"
              style={{ width: 240, height: 240, margin: "0 auto 1rem", background: "#fff" }}
              dangerouslySetInnerHTML={{ __html: p.qrSvg }}
            />
          )}
          <div className="row">
            <div style={{ flexBasis: "320px" }}>
              <label htmlFor="pay-url">Payment link</label>
              <input id="pay-url" readOnly value={p.url} onFocus={(e) => e.target.select()} />
            </div>
            <div className="shrink">
              <button
                type="button"
                className="secondary"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(p.url!);
                    setNote("Link copied. Paste it into a text message to the buyer.");
                  } catch {
                    setNote("Select the link and copy it.");
                  }
                }}
              >
                Copy link
              </button>
            </div>
          </div>
          <form
            className="row"
            style={{ marginTop: "0.75rem" }}
            onSubmit={(e) => {
              e.preventDefault();
              startTransition(async () => {
                const r = await emailLinkAction(p.checkoutId, email);
                setNote(r.status === "error" ? null : `Link emailed to ${email}.`);
                setError(r.status === "error" ? r.error : null);
              });
            }}
          >
            <div style={{ flexBasis: "260px" }}>
              <label htmlFor="link-email">Email the link to</label>
              <input id="link-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="shrink">
              <button type="submit" className="secondary" disabled={pending}>Email link</button>
            </div>
          </form>
          {note && <p className="muted">{note}</p>}
        </div>
      )}
      <button
        type="button"
        className="danger"
        disabled={pending}
        onClick={() => {
          if (!confirm("Cancel this payment? Nothing has been charged unless Square has already confirmed it.")) return;
          startTransition(async () => {
            const r = await cancelCheckoutAction(p.eventId, p.checkoutId);
            if (r.status === "error") setError(r.error);
            else {
              const s = await pollCheckoutAction(p.eventId, p.checkoutId);
              if (s.status === "ok") {
                setState(s.state);
                setReason(s.cancelReason);
              }
            }
          });
        }}
      >
        Cancel payment
      </button>
    </>
  );
}
