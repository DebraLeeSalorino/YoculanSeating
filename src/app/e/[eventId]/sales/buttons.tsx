"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { approveCompsAction, declineCompsAction, resolveOversoldAction, retryCashAction, type ActionResult } from "./actions";

/** A button that runs a server action, optionally after a confirmation, and shows the outcome. */
export function ActionButton({
  label,
  confirmText,
  className,
  run,
}: {
  label: string;
  confirmText?: string;
  className?: string;
  run: () => Promise<ActionResult>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        className={className}
        disabled={pending}
        onClick={() => {
          if (confirmText && !confirm(confirmText)) return;
          startTransition(async () => {
            const r = await run();
            setError(r.status === "error" ? r.error : null);
            router.refresh();
          });
        }}
      >
        {pending ? "…" : label}
      </button>
      {error && (
        <span role="alert" style={{ color: "var(--danger)", marginLeft: "0.5rem" }}>
          {error}
        </span>
      )}
    </>
  );
}

export function CompDecision({ eventId, customerIds }: { eventId: string; customerIds: string[] }) {
  return (
    <>
      <ActionButton label="Approve" run={() => approveCompsAction(eventId, customerIds)} />{" "}
      <ActionButton
        label="Decline"
        className="secondary"
        confirmText="Decline? The tickets become Unpaid; the seller can take payment or ask you to cancel them."
        run={() => declineCompsAction(eventId, customerIds)}
      />
    </>
  );
}

export function ResolveOversoldButton({ eventId, checkoutId }: { eventId: string; checkoutId: string }) {
  return <ActionButton label="Mark resolved" className="secondary" run={() => resolveOversoldAction(eventId, checkoutId)} />;
}

export function RetryCashButton({ eventId }: { eventId: string }) {
  return <ActionButton label="Try again" className="secondary" run={() => retryCashAction(eventId)} />;
}
