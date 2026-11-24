import Link from "next/link";
import QRCode from "qrcode";
import { getEvent } from "@/domain/events";
import { can } from "@/domain/permissions";
import { getCheckout } from "@/domain/square";
import { requireUser } from "@/lib/session";
import { NoPermission } from "../../no-permission";
import { CheckoutStatus } from "./status";

export default async function CheckoutPage({ params }: { params: Promise<{ eventId: string; checkoutId: string }> }) {
  const { eventId, checkoutId } = await params;
  const user = await requireUser();
  const actor = { userId: user.id };
  const { event, role } = await getEvent(actor, eventId);
  if (!can(role, "takePayment")) return <NoPermission />;
  const c = await getCheckout(actor, checkoutId);
  const money = new Intl.NumberFormat(undefined, { style: "currency", currency: c.currency });
  const qr = c.kind === "link" && c.url ? await QRCode.toString(c.url, { type: "svg", margin: 1, width: 240 }) : null;

  return (
    <div style={{ maxWidth: 640 }}>
      <p>
        <Link href={`/e/${eventId}/sales`}>← Sales</Link>
      </p>
      <h1>
        {money.format(c.amountCents / 100)} · {c.kind === "terminal" ? "Square Terminal" : "Square payment page"}
      </h1>
      <p className="muted">
        {event.name}: {c.names.join(", ")}
      </p>
      <CheckoutStatus
        eventId={eventId}
        checkoutId={c.id}
        kind={c.kind}
        initialState={c.status}
        url={c.url}
        qrSvg={qr}
        cancelReason={c.cancelReason}
      />
    </div>
  );
}
