"use client";

import { useActionState, useState, useTransition } from "react";
import type { Role } from "@/domain/permissions";
import type { FormState } from "@/lib/session";
import { changeRoleAction, inviteAction, removeUserAction, sendResetAction } from "./actions";

type RoleOption = { value: Role; label: string };

export function InviteForm({ eventId, roles }: { eventId: string; roles: RoleOption[] }) {
  const [state, action, pending] = useActionState(inviteAction.bind(null, eventId), {} as FormState);
  return (
    <form action={action} className="card" style={{ marginBottom: "1.25rem" }}>
      <h2 style={{ marginTop: 0 }}>Invite someone</h2>
      {state.error && <div className="notice error" role="alert">{state.error}</div>}
      {state.ok && <div className="notice ok" role="status">{state.ok}</div>}
      <div className="row">
        <div>
          <label htmlFor="inv-name">Name</label>
          <input id="inv-name" name="name" required />
        </div>
        <div>
          <label htmlFor="inv-email">Email</label>
          <input id="inv-email" name="email" type="email" required />
        </div>
        <div>
          <label htmlFor="inv-role">Role</label>
          <select id="inv-role" name="role" defaultValue="ticket_seller">
            {roles.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
        <div className="shrink">
          <button type="submit" disabled={pending}>Send invitation</button>
        </div>
      </div>
    </form>
  );
}

export function MemberActions({
  eventId,
  userId,
  name,
  role,
  roles,
  isSelf,
}: {
  eventId: string;
  userId: string;
  name: string;
  role: Role;
  roles: RoleOption[];
  isSelf: boolean;
}) {
  const [message, setMessage] = useState<FormState>({});
  const [pending, startTransition] = useTransition();
  const run = (fn: () => Promise<FormState>) => startTransition(async () => setMessage(await fn()));

  return (
    <div className="row" style={{ alignItems: "center" }}>
      <div style={{ flexBasis: "150px" }}>
        <select
          aria-label={`Role for ${name}`}
          value={role}
          disabled={pending}
          onChange={(e) => run(() => changeRoleAction(eventId, userId, e.target.value as Role))}
        >
          {roles.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </div>
      <div className="shrink">
        <button type="button" className="link" disabled={pending} onClick={() => run(() => sendResetAction(eventId, userId))}>
          Send password reset
        </button>
      </div>
      {!isSelf && (
        <div className="shrink">
          <button
            type="button"
            className="link"
            disabled={pending}
            onClick={() => {
              if (confirm(`Remove ${name}? Their access ends now; nothing they did is deleted.`)) {
                run(() => removeUserAction(eventId, userId));
              }
            }}
          >
            Remove
          </button>
        </div>
      )}
      {message.error && <span style={{ color: "var(--danger)" }}>{message.error}</span>}
      {message.ok && <span className="muted">{message.ok}</span>}
    </div>
  );
}
