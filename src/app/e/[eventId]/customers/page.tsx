import Link from "next/link";
import { getCapacity } from "@/domain/capacity";
import { listCustomers } from "@/domain/customers";
import { getEvent } from "@/domain/events";
import { listGroups } from "@/domain/groups";
import { listSections } from "@/domain/comps";
import { can, roleIn } from "@/domain/permissions";
import { requireUser } from "@/lib/session";
import { NoPermission } from "../no-permission";
import { QuickAdd } from "./quick-add";

const STATUS_LABELS: Record<string, string> = {
  paid: "Paid",
  unpaid: "Unpaid",
  complimentary: "Comp",
  comp_pending: "Comp pending",
  refunded: "Refunded",
};

const FILTERS = [
  ["all", "All"],
  ["unpaid", "Unpaid"],
  ["waiting", "Waiting for a seat"],
  ["seated", "Seated"],
] as const;

export default async function CustomersPage({
  params,
  searchParams,
}: {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<{ q?: string; filter?: string }>;
}) {
  const { eventId } = await params;
  const { q = "", filter = "all" } = await searchParams;
  const user = await requireUser();
  if (!can(await roleIn(user.id, eventId), "editCustomers")) return <NoPermission />;
  const actor = { userId: user.id };
  const { event, role } = await getEvent(actor, eventId);
  const validFilter = FILTERS.some(([f]) => f === filter) ? (filter as (typeof FILTERS)[number][0]) : "all";
  const [customers, capacity, groups, sections] = await Promise.all([
    listCustomers(actor, eventId, { search: q, filter: validFilter }),
    getCapacity(eventId),
    listGroups(actor, eventId),
    listSections(actor, eventId),
  ]);
  const showContact = can(role, "seeContactDetails");
  const money = new Intl.NumberFormat(undefined, { style: "currency", currency: event.currency });

  return (
    <>
      <div className="row" style={{ alignItems: "center", marginBottom: "1rem" }}>
        <h1 style={{ margin: 0 }}>Customers</h1>
        {can(role, "enterEventbriteOrders") && (
          <div className="shrink">
            <Link className="button secondary" href={`/e/${eventId}/customers/eventbrite`}>
              Enter an Eventbrite order
            </Link>
          </div>
        )}
      </div>

      <div className="stats" aria-label="Ticket totals">
        <span>
          <strong>{capacity.seatedLeft}</strong> of {capacity.generalSeats} seated tickets left
          {!capacity.fromFloorPlan && <span className="muted"> (typed-in seat count)</span>}
        </span>
        <span>
          <strong>{capacity.standingOpen ? capacity.standingLeft : 0}</strong> standing room{" "}
          {capacity.standingOpen ? "left" : `(opens when seated sells out; ${capacity.standingTickets} set)`}
        </span>
        <span>
          <strong>{capacity.unpaidOutstanding}</strong> unpaid tickets
        </span>
      </div>
      {capacity.allSoldOut ? (
        <div className="notice error">Sold out. All selling is closed.</div>
      ) : capacity.seatedSoldOut ? (
        <div className="notice warn">Seated tickets are sold out. Standing room is open.</div>
      ) : capacity.nearlySoldOut ? (
        <div className="notice warn">
          Nearly sold out: {capacity.seatedLeft} seated tickets left, with {capacity.unpaidOutstanding} unpaid tickets
          outstanding that may not all be honoured.
        </div>
      ) : null}

      <QuickAdd
        eventId={eventId}
        groups={groups}
        canCompAny={can(role, "compAny")}
        canCompFriends={can(role, "compFriendsAndFamily")}
        sections={sections.filter((s) => s.reserved).map((s) => ({ id: s.id, name: s.name }))}
      />

      <form className="row" style={{ marginBottom: "0.75rem" }} role="search">
        <div style={{ flexBasis: "260px" }}>
          <label htmlFor="q">Search by name{showContact ? ", email or phone" : ""}</label>
          <input id="q" name="q" defaultValue={q} type="search" />
        </div>
        <div>
          <label htmlFor="filter">Show</label>
          <select id="filter" name="filter" defaultValue={validFilter}>
            {FILTERS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="shrink">
          <button type="submit" className="secondary">Search</button>
        </div>
      </form>

      <p className="muted">{customers.length} {customers.length === 1 ? "customer" : "customers"}</p>
      <div className="table-wrap">
        <table className="list">
          <thead>
            <tr>
              <th>Name</th>
              {showContact && <th className="hide-narrow">Phone</th>}
              {showContact && <th className="hide-narrow">Email</th>}
              <th>Group</th>
              <th>Ticket</th>
              <th>Payment</th>
              <th>Seat</th>
            </tr>
          </thead>
          <tbody>
            {customers.map((c) => (
              <tr key={c.id}>
                <td>
                  <Link href={`/e/${eventId}/customers/${c.id}`}>{c.name}</Link>
                </td>
                {showContact && <td className="hide-narrow">{c.phone}</td>}
                {showContact && <td className="hide-narrow">{c.email}</td>}
                <td>{c.groupName}</td>
                <td>{c.ticketType === "seated" ? "Seated" : "Standing"}</td>
                <td>
                  <span className={`badge ${c.paymentStatus}`}>{STATUS_LABELS[c.paymentStatus]}</span>{" "}
                  <span className="muted">
                    {money.format(c.priceCents / 100)}
                    {c.channel === "eventbrite" ? " · Eventbrite" : ""}
                  </span>
                </td>
                <td>{c.seat ?? <span className="muted">—</span>}</td>
              </tr>
            ))}
            {customers.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  {q ? "No customers match that search." : "No customers yet. Add the first one above."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
