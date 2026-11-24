import Link from "next/link";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { customers, groups, orders } from "@/db/schema";
import { getEvent } from "@/domain/events";
import { can } from "@/domain/permissions";
import { paymentOptions } from "@/domain/square";
import { requireUser } from "@/lib/session";
import { NoPermission } from "../no-permission";
import { PayOptions } from "./pay-options";

/** Take payment for a set of unpaid tickets: /e/[eventId]/pay?ids=a,b,c */
export default async function PayPage({
  params,
  searchParams,
}: {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<{ ids?: string }>;
}) {
  const { eventId } = await params;
  const { ids = "" } = await searchParams;
  const user = await requireUser();
  const actor = { userId: user.id };
  const { event, role } = await getEvent(actor, eventId);
  if (!can(role, "takePayment")) return <NoPermission />;

  const wanted = ids.split(",").filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  const rows = wanted.length
    ? await db
        .select({ c: customers, groupName: groups.name, buyerEmail: orders.buyerEmail })
        .from(customers)
        .leftJoin(groups, eq(groups.id, customers.groupId))
        .leftJoin(orders, eq(orders.id, customers.orderId))
        .where(and(eq(customers.eventId, eventId), inArray(customers.id, wanted), isNull(customers.deletedAt)))
    : [];
  const unpaid = rows.filter((r) => r.c.paymentStatus === "unpaid");
  const options = await paymentOptions(actor, eventId);
  const money = new Intl.NumberFormat(undefined, { style: "currency", currency: event.currency });
  const total = unpaid.reduce((s, r) => s + r.c.priceCents, 0);

  return (
    <div style={{ maxWidth: 760 }}>
      <p>
        <Link href={`/e/${eventId}/sales`}>← Sales</Link>
      </p>
      <h1>Take payment</h1>
      {unpaid.length === 0 ? (
        <div className="card">
          <p>{rows.length ? "These tickets are already paid for." : "No tickets chosen."}</p>
        </div>
      ) : (
        <>
          <div className="card" style={{ marginBottom: "1rem" }}>
            <p style={{ marginTop: 0 }}>
              <strong>{unpaid[0]!.groupName ?? unpaid[0]!.c.name}</strong>: {unpaid.length} ticket{unpaid.length === 1 ? "" : "s"}
            </p>
            <ul>
              {unpaid.map((r) => (
                <li key={r.c.id}>
                  {r.c.name} · {r.c.ticketType === "seated" ? "Seated" : "Standing room"} · {money.format(r.c.priceCents / 100)}
                </li>
              ))}
            </ul>
            <p style={{ fontSize: "1.25rem", marginBottom: 0 }}>
              Total <strong>{money.format(total / 100)}</strong>
            </p>
          </div>
          <PayOptions
            eventId={eventId}
            customerIds={unpaid.map((r) => r.c.id)}
            total={money.format(total / 100)}
            squareReady={options.squareReady}
            terminals={options.terminals}
            sandbox={options.sandbox}
            buyerEmail={(showEmail(role) && unpaid[0]!.buyerEmail) || ""}
          />
        </>
      )}
    </div>
  );
}

/** Door staff never see customers' emails (spec 10.1). */
function showEmail(role: string) {
  return role !== "door_staff";
}
