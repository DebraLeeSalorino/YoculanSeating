import Link from "next/link";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { customers, groups, orders } from "@/db/schema";
import { listSections } from "@/domain/comps";
import { getCustomer } from "@/domain/customers";
import { getEvent } from "@/domain/events";
import { can, roleIn } from "@/domain/permissions";
import { requireUser } from "@/lib/session";
import { NoPermission } from "../../no-permission";
import { EditCustomer } from "./edit";
import { TicketActions } from "./ticket-actions";

export default async function CustomerPage({ params }: { params: Promise<{ eventId: string; customerId: string }> }) {
  const { eventId, customerId } = await params;
  const user = await requireUser();
  if (!can(await roleIn(user.id, eventId), "editCustomers")) return <NoPermission />;
  const actor = { userId: user.id };
  const { event, role } = await getEvent(actor, eventId);
  const c = await getCustomer(actor, customerId);
  const [group] = c.groupId ? await db.select().from(groups).where(eq(groups.id, c.groupId)) : [];
  const money = new Intl.NumberFormat(undefined, { style: "currency", currency: event.currency });
  const [order] = c.orderId ? await db.select().from(orders).where(eq(orders.id, c.orderId)) : [];
  const unpaidInGroup = c.groupId
    ? await db
        .select({ id: customers.id })
        .from(customers)
        .where(and(eq(customers.groupId, c.groupId), isNull(customers.deletedAt), eq(customers.paymentStatus, "unpaid")))
    : c.paymentStatus === "unpaid"
      ? [{ id: c.id }]
      : [];
  const sections = (await listSections(actor, eventId)).filter((s) => s.reserved);

  return (
    <div style={{ maxWidth: 760 }}>
      <p>
        <Link href={`/e/${eventId}/customers`}>← Customers</Link>
      </p>
      <h1>{c.name}</h1>
      <p className="muted">
        {c.ticketType === "seated" ? "Seated" : "Standing room"} · {money.format(c.priceCents / 100)} ·{" "}
        <span className={`badge ${c.paymentStatus}`}>{c.paymentStatus.replace("_", " ")}</span>
        {group?.hostName && <> · guest of {group.hostName}</>}
      </p>
      <EditCustomer
        eventId={eventId}
        customer={{
          id: c.id,
          name: c.name,
          phone: c.phoneDisplay,
          email: c.email ?? "",
          notes: c.notes ?? "",
          unpaid: c.paymentStatus === "unpaid",
        }}
        group={group ? { id: group.id, name: group.name, automatic: group.nameIsAutomatic } : null}
        canSeeContact={can(role, "seeContactDetails")}
        canDelete={can(role, "deleteCustomers")}
        canTakePayment={can(role, "takePayment")}
      />
      <TicketActions
        eventId={eventId}
        customerId={c.id}
        canRefund={can(role, "refund")}
        isPaid={c.paymentStatus === "paid"}
        unpaidGroupIds={unpaidInGroup.map((u) => u.id)}
        canComp={can(role, "compAny")}
        sections={sections.map((s) => ({ id: s.id, name: s.name }))}
        hasOrder={!!order}
        hasBuyerEmail={!!order?.buyerEmail}
      />
    </div>
  );
}
