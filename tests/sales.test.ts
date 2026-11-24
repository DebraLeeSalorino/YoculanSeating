import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { assignments, customers, events, groups, payments, seats, sections, tables } from "@/db/schema";
import { loadBuyerPage, saveGuests } from "@/domain/buyer-page";
import { getCapacity } from "@/domain/capacity";
import { approveComps, compUnpaidTickets, declineComps, listPendingComps } from "@/domain/comps";
import { createSale, listCustomers, updateCustomer, type SaleInput } from "@/domain/customers";
import { refundTickets } from "@/domain/refunds";
import { listUnpaid, salesTotals } from "@/domain/reports";
import { updateSettings, type EventSettings } from "@/domain/settings";
import { addMember, as, mailer, makeEvent } from "./helpers";

const people = (...names: string[]) => names.map((name) => ({ name }));

async function sale(actor: { id: string }, eventId: string, input: SaleInput) {
  const r = await createSale(as(actor), eventId, input);
  if (r.status !== "created") throw new Error("expected created");
  return r;
}

async function statuses(ids: string[]) {
  const rows = await db.select().from(customers);
  return ids.map((id) => rows.find((r) => r.id === id)!.paymentStatus);
}

async function section(eventId: string, kind: "general" | "sponsors" | "seller_ff" | "committee_ff") {
  const [s] = await db.select().from(sections).where(and(eq(sections.eventId, eventId), eq(sections.kind, kind)));
  return s!;
}

/** Draws a table with `n` seats in a section, so that section has a seat limit. */
async function drawTable(eventId: string, sectionId: string, label: string, n: number) {
  const [t] = await db
    .insert(tables)
    .values({ eventId, sectionId, label, shape: "round", width: 6, length: 6, x: 0, y: 0, seatCount: n })
    .returning();
  await db.insert(seats).values(Array.from({ length: n }, (_, i) => ({ tableId: t!.id, number: i + 1 })));
  return t!;
}

describe("comps", () => {
  it("a seller's comp stays pending, holds no place, and becomes Complimentary only when an admin approves", async () => {
    const { event, admin, seller } = await makeEvent({ generalSeatsOverride: 10 });
    const r = await sale(seller, event.id, { ticketType: "seated", payment: "comp", people: people("Pat Friend", "Lou Friend") });
    expect(await statuses(r.customerIds)).toEqual(["comp_pending", "comp_pending"]);

    const [g] = await db.select().from(groups).where(eq(groups.id, r.groupId));
    expect(g?.sectionId).toBe((await section(event.id, "seller_ff")).id);
    expect(g?.hostUserId).toBe(seller.id);
    expect((await getCapacity(event.id)).soldTotal).toBe(0);

    await expect(approveComps(as(seller), event.id, r.customerIds)).rejects.toThrow(/permission/);
    expect((await listPendingComps(as(admin), event.id))[0]?.sellerName).toBe("Sam Seller");

    await approveComps(as(admin), event.id, r.customerIds);
    expect(await statuses(r.customerIds)).toEqual(["complimentary", "complimentary"]);
    const rows = await db.select().from(customers);
    expect(rows.every((c) => c.compApprovedBy === admin.id && c.compGivenBy === seller.id)).toBe(true);
    // Reserved-section comps count toward the venue, not general sale.
    const cap = await getCapacity(event.id);
    expect(cap.soldTotal).toBe(2);
    expect(cap.seatedLeft).toBe(10);
  });

  it("a declined comp becomes Unpaid and its group moves to General", async () => {
    const { event, admin, seller } = await makeEvent();
    const r = await sale(seller, event.id, { ticketType: "seated", payment: "comp", people: people("Pat Friend") });
    await declineComps(as(admin), event.id, r.customerIds);
    expect(await statuses(r.customerIds)).toEqual(["unpaid"]);
    const [g] = await db.select().from(groups).where(eq(groups.id, r.groupId));
    expect(g?.sectionId).toBeNull();
    expect(await listPendingComps(as(admin), event.id)).toEqual([]);
  });

  it("an admin cannot approve a comp when its section is already full", async () => {
    const { event, admin, seller } = await makeEvent();
    const ff = await section(event.id, "seller_ff");
    await drawTable(event.id, ff.id, "F1", 2);
    const a = await sale(seller, event.id, { ticketType: "seated", payment: "comp", people: people("A", "B") });
    const b = await sale(seller, event.id, { ticketType: "seated", payment: "comp", people: people("C") });
    await approveComps(as(admin), event.id, a.customerIds);
    await expect(approveComps(as(admin), event.id, b.customerIds)).rejects.toThrow(/Seller friends and family is full/);
  });

  it("an admin's comp needs no approval and can go in any section", async () => {
    const { event, admin } = await makeEvent({ generalSeatsOverride: 10 });
    const committee = await section(event.id, "committee_ff");
    const r = await sale(admin, event.id, {
      ticketType: "seated",
      payment: "comp",
      compSectionId: committee.id,
      hostName: "Jo on the committee",
      people: people("Guest One"),
    });
    expect(await statuses(r.customerIds)).toEqual(["complimentary"]);
    const [g] = await db.select().from(groups).where(eq(groups.id, r.groupId));
    expect(g?.sectionId).toBe(committee.id);
    expect(g?.hostName).toBe("Jo on the committee");

    // A comp in General uses a general-sale seat.
    await sale(admin, event.id, { ticketType: "seated", payment: "comp", people: people("Press") });
    expect((await getCapacity(event.id)).seatedLeft).toBe(9);
  });

  it("an admin can comp a group's unpaid tickets, e.g. for a sponsor", async () => {
    const { event, admin, seller } = await makeEvent();
    const sponsors = await section(event.id, "sponsors");
    const r = await sale(seller, event.id, { ticketType: "seated", payment: "unpaid", people: people("CEO", "CFO") });
    await expect(compUnpaidTickets(as(seller), event.id, r.customerIds, { sectionId: null })).rejects.toThrow(/permission/);
    await expect(
      compUnpaidTickets(as(admin), event.id, [r.customerIds[0]!], { sectionId: sponsors.id }),
    ).rejects.toThrow(/every ticket/);
    await compUnpaidTickets(as(admin), event.id, r.customerIds, { sectionId: sponsors.id, hostName: "Acme" });
    expect(await statuses(r.customerIds)).toEqual(["complimentary", "complimentary"]);
  });

  it("a seller sees only their own pending comps", async () => {
    const { event, seller } = await makeEvent();
    const other = await addMember(event.id, "Olive Other", "ticket_seller");
    await sale(seller, event.id, { ticketType: "seated", payment: "comp", people: people("Mine") });
    await sale(other, event.id, { ticketType: "seated", payment: "comp", people: people("Theirs") });
    const mine = await listPendingComps(as(seller), event.id);
    expect(mine.flatMap((g) => g.customers.map((c) => c.name))).toEqual(["Mine"]);
  });
});

describe("refunds", () => {
  it("only an admin can refund, a reason is required, and the seat is freed and goes back on sale", async () => {
    const { event, admin, seller } = await makeEvent({ generalSeatsOverride: 5 });
    const r = await sale(seller, event.id, { ticketType: "seated", payment: "cash", people: people("A", "B") });
    const t = await drawTable(event.id, (await section(event.id, "general")).id, "1", 8);
    const [seat] = await db.select().from(seats).where(eq(seats.tableId, t.id));
    await db.insert(assignments).values({ customerId: r.customerIds[0]!, seatId: seat!.id, placedBy: "admin" });
    const before = (await getCapacity(event.id)).seatedLeft;

    await expect(refundTickets(as(seller), event.id, [r.customerIds[0]!], "error")).rejects.toThrow(/permission/);
    await expect(refundTickets(as(admin), event.id, [r.customerIds[0]!], "  ")).rejects.toThrow(/reason/);
    await refundTickets(as(admin), event.id, [r.customerIds[0]!], "Charged twice");

    expect(await statuses(r.customerIds)).toEqual(["refunded", "paid"]);
    expect(await db.select().from(assignments)).toHaveLength(0);
    expect((await getCapacity(event.id)).seatedLeft).toBe(before + 1);
    const refund = (await db.select().from(payments)).find((p) => p.kind === "refund");
    expect(refund).toMatchObject({ amountCents: 10000, method: "cash", reason: "Charged twice", takenBy: admin.id });
    // The record is kept.
    expect((await listCustomers(as(admin), event.id)).map((c) => c.name).sort()).toEqual(["A", "B"]);
    await expect(refundTickets(as(admin), event.id, [r.customerIds[0]!], "again")).rejects.toThrow(/Only paid/);
  });

  it("an Eventbrite refund is recorded against Eventbrite", async () => {
    const { event, admin } = await makeEvent();
    const r = await sale(admin, event.id, { ticketType: "seated", payment: "eventbrite", people: people("A") });
    await refundTickets(as(admin), event.id, r.customerIds, "Refunded in Eventbrite");
    const refund = (await db.select().from(payments)).find((p) => p.kind === "refund");
    expect(refund?.method).toBe("eventbrite");
  });
});

describe("settings", () => {
  const base = (eventId: string, overrides: Partial<EventSettings> = {}): EventSettings => ({
    name: "Gala",
    date: new Date("2027-11-13T18:00:00Z"),
    timeZone: "America/New_York",
    defaultCountry: "US",
    currency: "USD",
    seatedPriceCents: 12500,
    standingPriceCents: 6000,
    generalSeatsOverride: 200,
    standingTickets: 20,
    venueCapacity: 1400,
    sellOutWarningPercent: 90,
    buyerPageClosesAt: null,
    ...overrides,
  });

  it("rejects an unknown time zone", async () => {
    const { event, admin } = await makeEvent();
    await expect(updateSettings(as(admin), event.id, base(event.id, { timeZone: "Mars/Olympus" }))).rejects.toThrow(/time zone/);
  });

  it("only admins can change settings, and changes apply at once", async () => {
    const { event, admin, seller } = await makeEvent();
    await expect(updateSettings(as(seller), event.id, base(event.id))).rejects.toThrow(/permission/);
    await updateSettings(as(admin), event.id, base(event.id, { generalSeatsOverride: 300 }));
    expect((await getCapacity(event.id)).seatedLeft).toBe(300);
    const r = await sale(admin, event.id, { ticketType: "seated", payment: "cash", people: people("A") });
    const [c] = await db.select().from(customers).where(eq(customers.id, r.customerIds[0]!));
    expect(c?.priceCents).toBe(12500);
  });

  it("refuses a venue capacity below tickets already sold, or limits that add up to more than it", async () => {
    const { event, admin, seller } = await makeEvent({ generalSeatsOverride: 10 });
    await sale(seller, event.id, { ticketType: "seated", payment: "cash", people: people("A", "B", "C") });
    await expect(updateSettings(as(admin), event.id, base(event.id, { venueCapacity: 2, generalSeatsOverride: 2, standingTickets: 0 }))).rejects.toThrow(/already sold/);
    await expect(updateSettings(as(admin), event.id, base(event.id, { generalSeatsOverride: 2 }))).rejects.toThrow(/already sold/);
    await expect(updateSettings(as(admin), event.id, base(event.id, { venueCapacity: 100, generalSeatsOverride: 90 }))).rejects.toThrow(/add up to 110/);
    await updateSettings(as(admin), event.id, base(event.id, { venueCapacity: 100, generalSeatsOverride: 80 }));
    const cap = await getCapacity(event.id);
    expect([cap.venueCapacity, cap.generalSeats]).toEqual([100, 80]);
  });
});

describe("sales totals", () => {
  it("admins see every seller and channel; a seller sees only their own", async () => {
    const { event, admin, seller } = await makeEvent();
    const other = await addMember(event.id, "Olive Other", "ticket_seller");
    await sale(seller, event.id, { ticketType: "seated", payment: "cash", people: people("A", "B") });
    await sale(seller, event.id, { ticketType: "seated", payment: "unpaid", people: people("C") });
    await sale(seller, event.id, { ticketType: "seated", payment: "comp", people: people("D") });
    await sale(other, event.id, { ticketType: "seated", payment: "cash", people: people("E") });
    await sale(admin, event.id, { ticketType: "seated", payment: "eventbrite", people: people("F", "G", "H") });

    const all = await salesTotals(as(admin), event.id);
    const sam = all.sellers.find((s) => s.label === "Sam Seller")!;
    expect(sam).toMatchObject({ seatedSold: 2, paidCents: 20000, unpaidCount: 1, unpaidCents: 10000, pendingCompCount: 1 });
    expect(all.sellers.find((s) => s.label === "Eventbrite")).toMatchObject({ seatedSold: 3, paidCents: 30000 });
    expect(all.channels.find((c) => c.key === "cash")).toMatchObject({ seatedSold: 3, paidCents: 30000 });
    expect(all.total.paidCents).toBe(60000);

    const own = await salesTotals(as(seller), event.id);
    expect(own.everyone).toBe(false);
    expect(own.sellers.map((s) => s.label)).toEqual(["Sam Seller"]);
    expect(own.total.paidCents).toBe(20000);
  });

  it("lists unpaid tickets with the amount due", async () => {
    const { event, seller, door } = await makeEvent();
    await sale(seller, event.id, { ticketType: "seated", payment: "unpaid", people: people("Ann Unpaid") });
    const list = await listUnpaid(as(door), event.id);
    expect(list).toMatchObject([{ name: "Ann Unpaid", amountDueCents: 10000, sellerName: "Sam Seller" }]);
  });
});

describe("buyer page", () => {
  it("emails the buyer a private link when the order is created", async () => {
    const { event, seller } = await makeEvent();
    await sale(seller, event.id, {
      ticketType: "seated",
      payment: "cash",
      people: [{ name: "Ann Buyer", email: "ann@example.org" }, { name: "Guest" }],
    });
    const mail = mailer().last("ann@example.org");
    expect(mail?.subject).toBe("Your tickets for Gala 2027");
    expect(mail?.text).toMatch(/\/b\/[A-Za-z0-9_-]+/);
    // No email address, no email.
    await sale(seller, event.id, { ticketType: "seated", payment: "cash", people: people("No Email") });
    expect(mailer().sent).toHaveLength(1);
  });

  it("a buyer of four tickets names two guests; the others stay 'Guest of' and a seller can fill them in later", async () => {
    const { event, admin, seller } = await makeEvent();
    const r = await sale(admin, event.id, {
      ticketType: "seated",
      payment: "eventbrite",
      people: [{ name: "Ann Buyer", email: "ann@example.org" }, { name: "" }, { name: "" }, { name: "" }],
    });
    const code = mailer().last("ann@example.org")!.text.match(/\/b\/([A-Za-z0-9_-]+)/)![1]!;
    const page = (await loadBuyerPage(code))!;
    expect(page.tickets.map((t) => t.isPlaceholder)).toEqual([false, true, true, true]);
    expect(page.editable).toBe(true);

    await saveGuests(code, [
      { customerId: page.tickets[1]!.id, name: "Ben Guest", email: "ben@example.org" },
      { customerId: page.tickets[2]!.id, name: "Cy Guest", phone: "212 736 5000" },
    ]);
    const names = (await listCustomers(as(seller), event.id)).map((c) => c.name).sort();
    expect(names).toEqual(["Ann Buyer", "Ben Guest", "Cy Guest", "Guest of Ann Buyer"]);

    // The buyer's own ticket and other orders' tickets can't be changed from the page.
    await expect(saveGuests(code, [{ customerId: page.tickets[0]!.id, name: "Someone Else" }])).rejects.toThrow(/can't be changed/);
    const other = await sale(seller, event.id, { ticketType: "seated", payment: "unpaid", people: people("X", "Y") });
    await expect(saveGuests(code, [{ customerId: other.customerIds[1]!, name: "Hijack" }])).rejects.toThrow(/can't be changed/);

    await updateCustomer(as(seller), r.customerIds[3]!, { name: "Dee Late" });
    expect((await loadBuyerPage(code))!.tickets[3]!.name).toBe("Dee Late");
  });

  it("stops accepting changes when editing closes", async () => {
    const { event, seller } = await makeEvent();
    await sale(seller, event.id, {
      ticketType: "seated",
      payment: "cash",
      people: [{ name: "Ann Buyer", email: "ann@example.org" }, { name: "Guest of Ann Buyer" }],
    });
    const code = mailer().last("ann@example.org")!.text.match(/\/b\/([A-Za-z0-9_-]+)/)![1]!;
    await db.update(events).set({ buyerPageClosesAt: new Date(Date.now() - 60_000) }).where(eq(events.id, event.id));
    const page = (await loadBuyerPage(code))!;
    expect(page.editable).toBe(false);
    await expect(saveGuests(code, [{ customerId: page.tickets[1]!.id, name: "Late" }])).rejects.toThrow(/no longer/);
  });

  it("an unknown link shows nothing", async () => {
    expect(await loadBuyerPage("not-a-real-code")).toBeNull();
  });
});
