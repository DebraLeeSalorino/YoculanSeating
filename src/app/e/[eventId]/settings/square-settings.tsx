"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { addTestTerminalAction, checkPairingAction, removeTerminalAction, setLocationAction, startPairingAction } from "./square-actions";

interface Props {
  eventId: string;
  connected: boolean;
  environment?: string;
  locationId: string | null;
  locations: { id: string; name: string; currency: string; status: string }[];
  terminals: { deviceId: string; name: string }[];
  error: string | null;
}

export function SquareSettings(p: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [location, setLocation] = useState(p.locationId ?? "");
  const [terminalName, setTerminalName] = useState("");
  const [pairing, setPairing] = useState<{ codeId: string; code: string; name: string } | null>(null);

  const show = (r: { status: "ok" } | { status: "error"; error: string }, ok: string) => {
    setMessage(r.status === "error" ? { kind: "error", text: r.error } : { kind: "ok", text: ok });
    router.refresh();
  };

  // While a pairing code is showing, check every few seconds whether the terminal has signed in.
  useEffect(() => {
    if (!pairing) return;
    const timer = setInterval(async () => {
      const r = await checkPairingAction(p.eventId, pairing.codeId, pairing.name);
      if (r.status === "error") {
        setMessage({ kind: "error", text: r.error });
        setPairing(null);
      } else if (r.pairing === "PAIRED") {
        setMessage({ kind: "ok", text: `${pairing.name} is paired.` });
        setPairing(null);
        router.refresh();
      } else if (r.pairing === "EXPIRED") {
        setMessage({ kind: "error", text: "The code expired. Start pairing again." });
        setPairing(null);
      }
    }, 4000);
    return () => clearInterval(timer);
  }, [pairing, p.eventId, router]);

  if (!p.connected) {
    return (
      <div className="card" style={{ maxWidth: 760, marginTop: "1.25rem" }}>
        <h2 style={{ marginTop: 0 }}>Square</h2>
        <p>
          Square isn't connected. Its access token is set in the hosting service's secret settings (never in the app), so
          it stays hidden after setup.
        </p>
      </div>
    );
  }

  return (
    <div className="card" style={{ maxWidth: 760, marginTop: "1.25rem" }}>
      <h2 style={{ marginTop: 0 }}>
        Square {p.environment === "sandbox" && <span className="badge unpaid">Sandbox: test payments only</span>}
      </h2>
      {p.error && <div className="notice error">Square could not be reached: {p.error}</div>}
      {message && <div className={`notice ${message.kind}`} role="status">{message.text}</div>}

      <div className="row">
        <div style={{ flexBasis: "280px" }}>
          <label htmlFor="sq-location">Square location for this event's sales</label>
          <select id="sq-location" value={location} onChange={(e) => setLocation(e.target.value)}>
            <option value="">Choose…</option>
            {p.locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name} ({l.currency}){l.status !== "ACTIVE" ? " – inactive" : ""}
              </option>
            ))}
          </select>
        </div>
        <div className="shrink">
          <button
            type="button"
            className="secondary"
            disabled={pending || !location || location === p.locationId}
            onClick={() => startTransition(async () => show(await setLocationAction(p.eventId, location), "Location saved."))}
          >
            Save location
          </button>
        </div>
      </div>

      <h3>Terminals</h3>
      {p.terminals.length === 0 ? (
        <p className="muted">No terminals paired yet.</p>
      ) : (
        <ul>
          {p.terminals.map((t) => (
            <li key={t.deviceId}>
              {t.name}{" "}
              <button
                type="button"
                className="link"
                disabled={pending}
                onClick={() => {
                  if (confirm(`Remove ${t.name}?`)) startTransition(async () => show(await removeTerminalAction(p.eventId, t.deviceId), "Terminal removed."));
                }}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {pairing ? (
        <div className="notice warn" role="status">
          On the Square Terminal, choose <strong>Sign in → Use a device code</strong> and enter:
          <div style={{ fontSize: "2rem", fontWeight: 700, letterSpacing: "0.2em", margin: "0.5rem 0" }}>{pairing.code}</div>
          Waiting for the terminal… <button type="button" className="link" onClick={() => setPairing(null)}>Cancel</button>
        </div>
      ) : (
        <div className="row">
          <div>
            <label htmlFor="sq-term-name">Terminal name</label>
            <input id="sq-term-name" placeholder="e.g. Door 1" value={terminalName} onChange={(e) => setTerminalName(e.target.value)} />
          </div>
          <div className="shrink">
            <button
              type="button"
              className="secondary"
              disabled={pending || !p.locationId}
              onClick={() =>
                startTransition(async () => {
                  const r = await startPairingAction(p.eventId, terminalName);
                  if (r.status === "error") setMessage({ kind: "error", text: r.error });
                  else {
                    setMessage(null);
                    setPairing({ codeId: r.codeId, code: r.code, name: r.name });
                  }
                })
              }
            >
              Pair a terminal
            </button>
          </div>
          {p.environment !== "production" && (
            <div className="shrink">
              <button
                type="button"
                className="secondary"
                disabled={pending}
                onClick={() => startTransition(async () => show(await addTestTerminalAction(p.eventId), "Sandbox test terminal added."))}
              >
                Add sandbox test terminal
              </button>
            </div>
          )}
        </div>
      )}
      {!p.locationId && <p className="muted">Choose the location before pairing terminals.</p>}
    </div>
  );
}
