"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { DuplicateMatch } from "@/domain/customers";
import { deleteCustomerAction, renameGroupAction, takeCashAction, updateCustomerAction } from "../actions";

interface Props {
  eventId: string;
  customer: { id: string; name: string; phone: string; email: string; notes: string; unpaid: boolean };
  group: { id: string; name: string; automatic: boolean } | null;
  canSeeContact: boolean;
  canDelete: boolean;
  canTakePayment: boolean;
}

export function EditCustomer({ eventId, customer, group, canSeeContact, canDelete, canTakePayment }: Props) {
  const router = useRouter();
  const [form, setForm] = useState(customer);
  const [groupName, setGroupName] = useState(group && !group.automatic ? group.name : "");
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [duplicates, setDuplicates] = useState<DuplicateMatch[] | null>(null);
  const [pending, startTransition] = useTransition();

  function save(confirmDuplicates = false) {
    startTransition(async () => {
      const r = await updateCustomerAction(customer.id, { ...form, confirmDuplicates });
      if (r.status === "error") setMessage({ kind: "error", text: r.error });
      else if (r.status === "duplicate") setDuplicates(r.matches);
      else {
        setDuplicates(null);
        setMessage({ kind: "ok", text: "Saved." });
        router.refresh();
      }
    });
  }

  return (
    <>
      {message && <div className={`notice ${message.kind}`} role="status">{message.text}</div>}
      {duplicates && (
        <div className="notice warn" role="alert">
          This email is already used by {duplicates.map((d) => d.customerName).join(", ")}.{" "}
          <button type="button" onClick={() => save(true)}>Save anyway</button>{" "}
          <button type="button" className="secondary" onClick={() => setDuplicates(null)}>Cancel</button>
        </div>
      )}
      <form
        className="card"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <div className="field">
          <label htmlFor="name">Name</label>
          <input id="name" required maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        {canSeeContact && (
          <div className="row">
            <div className="field">
              <label htmlFor="phone">Phone</label>
              <input id="phone" inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="email">Email</label>
              <input id="email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
          </div>
        )}
        <div className="field">
          <label htmlFor="notes">Notes for admins</label>
          <textarea id="notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </div>
        <button type="submit" disabled={pending}>Save</button>
      </form>

      {group && (
        <form
          className="card"
          style={{ marginTop: "1rem" }}
          onSubmit={(e) => {
            e.preventDefault();
            startTransition(async () => {
              const r = await renameGroupAction(group.id, groupName);
              setMessage(r.status === "error" ? { kind: "error", text: r.error } : { kind: "ok", text: "Group name saved." });
              router.refresh();
            });
          }}
        >
          <h2 style={{ marginTop: 0 }}>Group: {group.name}</h2>
          <div className="row">
            <div>
              <label htmlFor="group-name">Group name (leave blank for automatic)</label>
              <input id="group-name" value={groupName} maxLength={120} placeholder={group.name} onChange={(e) => setGroupName(e.target.value)} />
            </div>
            <div className="shrink">
              <button type="submit" className="secondary" disabled={pending}>Save name</button>
            </div>
          </div>
        </form>
      )}

      <div className="row" style={{ marginTop: "1rem" }}>
        {customer.unpaid && canTakePayment && (
          <div className="shrink">
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                if (!confirm("Record cash received for this ticket?")) return;
                startTransition(async () => {
                  const r = await takeCashAction(eventId, [customer.id]);
                  setMessage(r.status === "error" ? { kind: "error", text: r.error } : { kind: "ok", text: "Cash payment recorded." });
                  router.refresh();
                });
              }}
            >
              Cash received
            </button>
          </div>
        )}
        {canDelete && (
          <div className="shrink">
            <button
              type="button"
              className="danger"
              disabled={pending}
              onClick={() => {
                if (!confirm(`Delete ${customer.name}? Their seat is freed; the rest of their group stays.`)) return;
                startTransition(() => deleteCustomerAction(eventId, customer.id));
              }}
            >
              Delete customer
            </button>
          </div>
        )}
      </div>
    </>
  );
}
