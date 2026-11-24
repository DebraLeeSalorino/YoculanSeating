import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { groups, sections } from "@/db/schema";
import { getCapacity } from "@/domain/capacity";
import { createSale, takeCashPayment } from "@/domain/customers";
import { as, makeEvent } from "./helpers";

const people = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `Person ${i + 1}` }));

describe("capacity, sell-out and standing room", () => {
  it("with 200 seats on general sale, the 181st sold ticket triggers the warning and a 201st is refused", async () => {
    const { event, admin, seller } = await makeEvent({ generalSeatsOverride: 200 });
    await createSale(as(seller), event.id, { ticketType: "seated", payment: "cash", people: people(180) });
    expect((await getCapacity(event.id)).nearlySoldOut).toBe(false);

    await createSale(as(seller), event.id, { ticketType: "seated", payment: "cash", people: people(1) });
    const cap = await getCapacity(event.id);
    expect(cap.nearlySoldOut).toBe(true);
    expect(cap.seatedLeft).toBe(19);

    // Unpaid tickets don't change the count.
    await createSale(as(seller), event.id, { ticketType: "seated", payment: "unpaid", people: people(30) });
    expect((await getCapacity(event.id)).seatedLeft).toBe(19);
    expect((await getCapacity(event.id)).unpaidOutstanding).toBe(30);

    await createSale(as(admin), event.id, { ticketType: "seated", payment: "eventbrite", people: people(19) });
    expect((await getCapacity(event.id)).seatedSoldOut).toBe(true);
    await expect(
      createSale(as(seller), event.id, { ticketType: "seated", payment: "cash", people: people(1) }),
    ).rejects.toThrow(/sold out/);
  });

  it("refuses a sale bigger than what is left, before any money is taken", async () => {
    const { event, seller } = await makeEvent({ generalSeatsOverride: 5 });
    await expect(
      createSale(as(seller), event.id, { ticketType: "seated", payment: "cash", people: people(6) }),
    ).rejects.toThrow(/Only 5 seated tickets/);
    const r = await createSale(as(seller), event.id, { ticketType: "seated", payment: "unpaid", people: people(6) });
    if (r.status !== "created") throw new Error();
    await expect(takeCashPayment(as(seller), event.id, r.customerIds)).rejects.toThrow(/Only 5/);
  });

  it("standing room cannot be sold while a seated ticket is available, and can be once they are gone", async () => {
    const { event, seller } = await makeEvent({ generalSeatsOverride: 2, standingTickets: 3 });
    await expect(
      createSale(as(seller), event.id, { ticketType: "standing", payment: "cash", people: people(1) }),
    ).rejects.toThrow(/Standing room opens only/);

    await createSale(as(seller), event.id, { ticketType: "seated", payment: "cash", people: people(2) });
    const cap = await getCapacity(event.id);
    expect(cap.standingOpen).toBe(true);
    await createSale(as(seller), event.id, { ticketType: "standing", payment: "cash", people: people(3) });

    const end = await getCapacity(event.id);
    expect(end.allSoldOut).toBe(true);
    await expect(
      createSale(as(seller), event.id, { ticketType: "standing", payment: "cash", people: people(1) }),
    ).rejects.toThrow(/Everything is sold out/);
  });

  it("never sells past the venue's total capacity", async () => {
    const { event, seller } = await makeEvent({ generalSeatsOverride: 10, venueCapacity: 4 });
    await expect(
      createSale(as(seller), event.id, { ticketType: "seated", payment: "cash", people: people(5) }),
    ).rejects.toThrow(/venue is full/);
  });

  it("tickets in a reserved section don't count toward general sale", async () => {
    const { event, seller } = await makeEvent({ generalSeatsOverride: 2 });
    const [sponsors] = await db.select().from(sections).where(eq(sections.name, "Sponsors"));
    const r = await createSale(as(seller), event.id, { ticketType: "seated", payment: "unpaid", people: people(4) });
    if (r.status !== "created") throw new Error();
    await db.update(groups).set({ sectionId: sponsors!.id }).where(eq(groups.id, r.groupId));
    await takeCashPayment(as(seller), event.id, r.customerIds);
    expect((await getCapacity(event.id)).seatedLeft).toBe(2);
  });

  it("two sales racing for the last seat can't both succeed", async () => {
    const { event, seller } = await makeEvent({ generalSeatsOverride: 1 });
    const results = await Promise.allSettled([
      createSale(as(seller), event.id, { ticketType: "seated", payment: "cash", people: people(1) }),
      createSale(as(seller), event.id, { ticketType: "seated", payment: "cash", people: people(1) }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await getCapacity(event.id)).soldGeneralSeated).toBe(1);
  });
});
