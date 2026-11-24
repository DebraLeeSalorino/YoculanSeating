import Link from "next/link";
import { getCapacity } from "@/domain/capacity";
import { listPendingComps } from "@/domain/comps";
import { getEvent } from "@/domain/events";
import { can } from "@/domain/permissions";
import { listUnpaid, salesTotals, type SalesTotals } from "@/domain/reports";
import { requireUser } from "@/lib/session";
import { NoPermission } from "../no-permission";
import { CashButton, CompDecision } from "./buttons";

export default async function SalesPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const user = await requireUser();
  const actor = { userId: user.id };
  const { event, role } = await getEvent(actor, eventId);
  if (!can(role, "takePayment")) return <NoPermission />;

  const [capacity, unpaid, pending, totals] = await Promise.all([
    getCapacity(eventId),
    listUnpaid(actor, eventId),
    can(role, "compFriendsAndFamily") ? listPendingComps(actor, eventId) : Promise.resolve([]),
    can(role, "seeOwnSalesTotals") ? salesTotals(actor, eventId) : Promise.resolve(null),
  ]);
  const money = new Intl.NumberFormat(undefined, { style: "currency", currency: event.currency });
  const m = (cents: number) => money.format(cents / 100);

  // Unpaid tickets, gathered by group so a party pays together.
  const unpaidGroups = new Map<string, { name: string; seller: string | null; rows: typeof unpaid }>();
  for (const u of unpaid) {
    const key = u.groupId ?? u.id;
    if (!unpaidGroups.has(key)) unpaidGroups.set(key, { name: u.groupName ?? u.name, seller: u.sellerName, rows: [] });
    unpaidGroups.get(key)!.rows.push(u);
  }
  const showNames = can(role, "editCustomers");

  return (
    <>
      <h1>Sales</h1>
      <div className="stats" aria-label="Tickets sold">
        <span>
          <strong>{capacity.soldGeneralSeated}</strong> of {capacity.generalSeats} seated tickets on general sale sold
        </span>
        <span>
          <strong>{capacity.soldStanding}</strong> of {capacity.standingTickets} standing room sold
        </span>
        <span>
          <strong>{capacity.soldTotal}</strong> of {capacity.venueCapacity} venue capacity used
        </span>
      </div>
      {capacity.allSoldOut ? (
        <div className="notice error">Sold out. All selling is closed.</div>
      ) : capacity.seatedSoldOut ? (
        <div className="notice warn">Seated tickets are sold out. Standing room is open ({capacity.standingLeft} left).</div>
      ) : capacity.nearlySoldOut ? (
        <div className="notice warn">
          Nearly sold out: {capacity.seatedLeft} seated tickets left, and {capacity.unpaidOutstanding} unpaid tickets
          outstanding that may not all be honoured.
        </div>
      ) : null}

      {can(role, "compFriendsAndFamily") && (
        <>
          <h2>{can(role, "approveComps") ? "Comps waiting for approval" : "Your comps waiting for approval"}</h2>
          {pending.length === 0 ? (
            <p className="muted">None.</p>
          ) : (
            <div className="table-wrap">
              <table className="list">
                <thead>
                  <tr>
                    <th>Group</th>
                    <th>Guests</th>
                    <th>Given by</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {pending.map((p) => (
                    <tr key={p.groupId ?? p.customers[0]!.id}>
                      <td>{p.groupName}</td>
                      <td>{p.customers.map((c) => c.name).join(", ")}</td>
                      <td>{p.sellerName}</td>
                      <td>
                        {can(role, "approveComps") ? (
                          <CompDecision eventId={eventId} customerIds={p.customers.map((c) => c.id)} />
                        ) : (
                          <span className="badge comp_pending">Pending</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      <h2>Unpaid tickets</h2>
      {unpaidGroups.size === 0 ? (
        <p className="muted">None.</p>
      ) : (
        <div className="table-wrap">
          <table className="list">
            <thead>
              <tr>
                <th>Group</th>
                <th>Tickets</th>
                <th>Amount due</th>
                <th>Seller</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {[...unpaidGroups.entries()].map(([key, g]) => {
                const due = g.rows.reduce((s, r) => s + r.amountDueCents, 0);
                return (
                  <tr key={key}>
                    <td>{g.name}</td>
                    <td>
                      {g.rows.map((r, i) => (
                        <span key={r.id}>
                          {i > 0 && ", "}
                          {showNames ? <Link href={`/e/${eventId}/customers/${r.id}`}>{r.name}</Link> : r.name}
                          {r.ticketType === "standing" && <span className="muted"> (standing)</span>}
                        </span>
                      ))}
                    </td>
                    <td>{m(due)}</td>
                    <td>{g.seller}</td>
                    <td>
                      <CashButton eventId={eventId} customerIds={g.rows.map((r) => r.id)} amount={m(due)} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted" style={{ fontSize: "0.85rem" }}>Card payments through Square arrive in a later update.</p>

      {totals && (
        <>
          <h2>{totals.everyone ? "Totals by seller" : "Your sales"}</h2>
          <TotalsTable rows={[...totals.sellers, ...(totals.sellers.length > 1 ? [totals.total] : [])]} m={m} />
          {totals.everyone && totals.channels.length > 0 && (
            <>
              <h2>Totals by channel</h2>
              <TotalsTable rows={totals.channels} m={m} channel />
            </>
          )}
        </>
      )}
    </>
  );
}

function TotalsTable({ rows, m, channel = false }: { rows: SalesTotals[]; m: (c: number) => string; channel?: boolean }) {
  if (rows.length === 0) return <p className="muted">No sales yet.</p>;
  return (
    <div className="table-wrap">
      <table className="list">
        <thead>
          <tr>
            <th>{channel ? "Channel" : "Seller"}</th>
            <th>Seated sold</th>
            <th>Standing sold</th>
            <th>Paid</th>
            {!channel && <th>Unpaid</th>}
            {!channel && <th>Comps</th>}
            <th>Refunded</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} style={r.key === "total" ? { fontWeight: 600 } : undefined}>
              <td>{r.label}</td>
              <td>{r.seatedSold}</td>
              <td>{r.standingSold}</td>
              <td>{m(r.paidCents)}</td>
              {!channel && (
                <td>
                  {r.unpaidCount} ({m(r.unpaidCents)})
                </td>
              )}
              {!channel && (
                <td>
                  {r.compCount}
                  {r.pendingCompCount > 0 && <span className="muted"> + {r.pendingCompCount} pending</span>}
                </td>
              )}
              <td>{m(r.refundedCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
