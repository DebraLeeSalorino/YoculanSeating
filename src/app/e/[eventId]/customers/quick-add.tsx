"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import type { DuplicateMatch } from "@/domain/customers";
import { saleAction } from "./actions";

interface GroupOption {
  id: string;
  name: string;
  size: number;
}

/**
 * Quick-add row (section 3.2): type a name, press Enter, and the cursor comes back to the
 * name box for the next person. "With previous" keeps a party together as it is keyed in.
 */
export function QuickAdd({ eventId, groups }: { eventId: string; groups: GroupOption[] }) {
  const router = useRouter();
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [ticketType, setTicketType] = useState<"seated" | "standing">("seated");
  const [payment, setPayment] = useState<"" | "unpaid" | "cash">("");
  const [group, setGroup] = useState<string>("new");
  const [previousGroup, setPreviousGroup] = useState<{ id: string; label: string } | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error" | "warn"; text: string } | null>(null);
  const [duplicates, setDuplicates] = useState<DuplicateMatch[] | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(confirmDuplicates = false) {
    if (!payment) {
      setMessage({ kind: "error", text: "Choose Unpaid or Cash received." });
      return;
    }
    const groupId = group === "new" ? null : group === "previous" ? (previousGroup?.id ?? null) : group;
    startTransition(async () => {
      const result = await saleAction(eventId, {
        ticketType,
        payment,
        people: [{ name, phone, email }],
        groupId,
        confirmDuplicates,
      });
      if (result.status === "error") {
        setMessage({ kind: "error", text: result.error });
        return;
      }
      if (result.status === "duplicate") {
        setDuplicates(result.matches);
        setMessage(null);
        return;
      }
      setMessage({ kind: "ok", text: `Added ${name.trim()}.` });
      setPreviousGroup({ id: result.groupId, label: name.trim() });
      setDuplicates(null);
      setName("");
      setPhone("");
      setEmail("");
      setPayment("");
      setGroup("previous");
      router.refresh();
      nameRef.current?.focus();
    });
  }

  return (
    <form
      className="card quick-add"
      onSubmit={(e) => {
        e.preventDefault();
        submit(false);
      }}
    >
      <h2 style={{ marginTop: 0 }}>Quick add</h2>
      {message && <div className={`notice ${message.kind}`} role={message.kind === "error" ? "alert" : "status"}>{message.text}</div>}
      {duplicates && (
        <div className="notice warn" role="alert">
          {duplicates.map((d) => (
            <div key={d.customerId + d.kind}>
              {d.kind === "email" ? "This email is already used by " : `Eventbrite order ${d.value} was already entered for `}
              <a href={`/e/${eventId}/customers/${d.customerId}`} target="_blank" rel="noreferrer">
                {d.customerName}
              </a>
              .
            </div>
          ))}
          <div style={{ marginTop: "0.5rem" }}>
            <button type="button" onClick={() => submit(true)} disabled={pending}>Save anyway</button>{" "}
            <button type="button" className="secondary" onClick={() => setDuplicates(null)}>Cancel</button>
          </div>
        </div>
      )}
      <div className="row">
        <div style={{ flexBasis: "180px" }}>
          <label htmlFor="qa-name">Name</label>
          <input id="qa-name" ref={nameRef} value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} autoFocus />
        </div>
        <div>
          <label htmlFor="qa-phone">Phone</label>
          <input id="qa-phone" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" />
        </div>
        <div style={{ flexBasis: "180px" }}>
          <label htmlFor="qa-email">Email</label>
          <input id="qa-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <label htmlFor="qa-type">Ticket</label>
          <select id="qa-type" value={ticketType} onChange={(e) => setTicketType(e.target.value as "seated" | "standing")}>
            <option value="seated">Seated</option>
            <option value="standing">Standing room</option>
          </select>
        </div>
        <div>
          <label htmlFor="qa-payment">Payment</label>
          <select id="qa-payment" value={payment} onChange={(e) => setPayment(e.target.value as "" | "unpaid" | "cash")} required>
            <option value="">Choose…</option>
            <option value="unpaid">Unpaid</option>
            <option value="cash">Cash received</option>
          </select>
        </div>
        <div style={{ flexBasis: "180px" }}>
          <label htmlFor="qa-group">Group</label>
          <select id="qa-group" value={group} onChange={(e) => setGroup(e.target.value)}>
            <option value="new">New group</option>
            {previousGroup && <option value="previous">With previous ({previousGroup.label})</option>}
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name} ({g.size})
              </option>
            ))}
          </select>
        </div>
        <div className="shrink">
          <button type="submit" disabled={pending}>{pending ? "Saving…" : "Add"}</button>
        </div>
      </div>
      <p className="muted" style={{ margin: "0.5rem 0 0", fontSize: "0.85rem" }}>
        Press Enter to add. Card payments through Square arrive in the next update.
      </p>
    </form>
  );
}
