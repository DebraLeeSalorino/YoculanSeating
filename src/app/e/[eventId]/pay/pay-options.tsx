"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { cashForTicketsAction } from "../sales/actions";
import { startLinkAction, startTerminalAction } from "./actions";

interface Props {
  eventId: string;
  customerIds: string[];
  total: string;
  squareReady: boolean;
  terminals: { deviceId: string; name: string }[];
  sandbox: boolean;
  buyerEmail: string;
}

/** The four ways to pay from spec section 3.4. */
export function PayOptions(p: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [deviceId, setDeviceId] = useState(p.terminals[0]?.deviceId ?? "");
  const [email, setEmail] = useState(p.buyerEmail);

  const go = (fn: () => Promise<{ status: "ok"; checkoutId: string } | { status: "error"; error: string }>) =>
    startTransition(async () => {
      setError(null);
      const r = await fn();
      if (r.status === "error") setError(r.error);
      else router.push(`/e/${p.eventId}/pay/${r.checkoutId}`);
    });

  return (
    <>
      {error && <div className="notice error" role="alert">{error}</div>}
      {!p.squareReady && (
        <div className="notice warn">
          Card payments aren't available until an admin connects Square and chooses its location in Settings.
        </div>
      )}

      {p.squareReady && (
        <div className="card" style={{ marginBottom: "1rem" }}>
          <h2 style={{ marginTop: 0 }}>Card or phone on a Square Terminal</h2>
          {p.terminals.length === 0 ? (
            <p className="muted">No terminal is paired yet. An admin can pair one in Settings.</p>
          ) : (
            <div className="row">
              <div>
                <label htmlFor="pay-terminal">Terminal</label>
                <select id="pay-terminal" value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
                  {p.terminals.map((t) => (
                    <option key={t.deviceId} value={t.deviceId}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="shrink">
                <button type="button" disabled={pending} onClick={() => go(() => startTerminalAction(p.eventId, p.customerIds, deviceId))}>
                  Charge {p.total} on terminal
                </button>
              </div>
            </div>
          )}
          {p.sandbox && (
            <p className="muted" style={{ fontSize: "0.85rem", marginBottom: 0 }}>
              Sandbox: the test terminal approves charges up to $25 and leaves larger ones waiting until they time out.
            </p>
          )}
        </div>
      )}

      {p.squareReady && (
        <div className="card" style={{ marginBottom: "1rem" }}>
          <h2 style={{ marginTop: 0 }}>Square payment page</h2>
          <div className="row">
            <div className="shrink">
              <button type="button" className="secondary" disabled={pending} onClick={() => go(() => startLinkAction(p.eventId, p.customerIds, null))}>
                Show payment code
              </button>
            </div>
          </div>
          <p className="muted" style={{ fontSize: "0.9rem" }}>The buyer scans the code with their phone and pays on Square's page.</p>
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              go(() => startLinkAction(p.eventId, p.customerIds, email));
            }}
          >
            <div style={{ flexBasis: "260px" }}>
              <label htmlFor="pay-email">Send payment link to</label>
              <input id="pay-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="shrink">
              <button type="submit" className="secondary" disabled={pending}>
                Send payment link
              </button>
            </div>
          </form>
          <p className="muted" style={{ fontSize: "0.9rem", marginBottom: 0 }}>
            To send by text instead, choose "Show payment code" and copy the link from there.
          </p>
        </div>
      )}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Cash</h2>
        <button
          type="button"
          className="secondary"
          disabled={pending}
          onClick={() => {
            if (!confirm(`Record ${p.total} cash received?`)) return;
            startTransition(async () => {
              const r = await cashForTicketsAction(p.eventId, p.customerIds);
              if (r.status === "error") setError(r.error);
              else router.push(`/e/${p.eventId}/sales`);
            });
          }}
        >
          Cash received
        </button>
        {p.squareReady && <p className="muted" style={{ fontSize: "0.9rem", marginBottom: 0 }}>Cash is also recorded in Square.</p>}
      </div>
    </>
  );
}
