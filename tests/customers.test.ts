import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { contacts, customers, groups, payments } from "@/db/schema";
import {
  createSale,
  deleteCustomer,
  getCustomer,
  listCustomers,
  takeCashPayment,
  updateCustomer,
} from "@/domain/customers";
import { renameGroup } from "@/domain/groups";
import { as, makeEvent } from "./helpers";

async function created(p: ReturnType<typeof createSale>) {
  const r = await p;
  if (r.status !== "created") throw new Error("expected created, got duplicate");
  return r;
}

describe("customers", () => {
  it("can be created with only a name, then edited to add phone and email", async () => {
    const { event, seller } = await makeEvent();
    const r = await created(
      createSale(as(seller), event.id, { ticketType: "seated", payment: "unpaid", people: [{ name: "Maria Rivera" }] }),
    );
    const id = r.customerIds[0]!;
    await updateCustomer(as(seller), id, { name: "Maria Rivera", phone: "(212) 736-5000", email: "maria@example.org" });
    const c = await getCustomer(as(seller), id);
    expect(c.phone).toBe("+12127365000"); // stored normalised
    expect(c.phoneDisplay).toBe("(212) 736-5000"); // shown in local format
    expect(c.email).toBe("maria@example.org");
  });

  it("rejects bad input", async () => {
    const { event, seller } = await makeEvent();
    const base = { ticketType: "seated" as const, payment: "unpaid" as const };
    await expect(createSale(as(seller), event.id, { ...base, people: [{ name: "  " }] })).rejects.toThrow(/name/);
    await expect(createSale(as(seller), event.id, { ...base, people: [{ name: "x".repeat(121) }] })).rejects.toThrow(/120/);
    await expect(createSale(as(seller), event.id, { ...base, people: [{ name: "A", email: "nope" }] })).rejects.toThrow(/email/);
    await expect(createSale(as(seller), event.id, { ...base, people: [{ name: "A", phone: "12" }] })).rejects.toThrow(/phone/);
  });

  it("a seller cannot save a customer without choosing Paid or Unpaid, and the sale is credited to them", async () => {
    const { event, seller } = await makeEvent();
    await expect(
      createSale(as(seller), event.id, { ticketType: "seated", payment: undefined, people: [{ name: "A" }] }),
    ).rejects.toThrow(/paid or unpaid/);
    const r = await created(
      createSale(as(seller), event.id, { ticketType: "seated", payment: "cash", people: [{ name: "A" }, { name: "B" }] }),
    );
    const rows = await db.select().from(customers).where(eq(customers.orderId, r.orderId));
    expect(rows.every((c) => c.soldBy === seller.id && c.paymentStatus === "paid")).toBe(true);
    const pays = await db.select().from(payments);
    expect(pays.map((p) => [p.method, p.amountCents])).toEqual([
      ["cash", 10000],
      ["cash", 10000],
    ]);
  });

  it("warns, without blocking, when an email matches an existing customer", async () => {
    const { event, seller } = await makeEvent();
    await created(
      createSale(as(seller), event.id, {
        ticketType: "seated",
        payment: "unpaid",
        people: [{ name: "Maria Rivera", email: "maria@example.org" }],
      }),
    );
    const again = await createSale(as(seller), event.id, {
      ticketType: "seated",
      payment: "unpaid",
      people: [{ name: "Maria R", email: "MARIA@example.org" }],
    });
    expect(again.status).toBe("duplicate");
    if (again.status === "duplicate") expect(again.matches[0]?.customerName).toBe("Maria Rivera");

    const saved = await createSale(as(seller), event.id, {
      ticketType: "seated",
      payment: "unpaid",
      people: [{ name: "Maria R", email: "maria@example.org" }],
      confirmDuplicates: true,
    });
    expect(saved.status).toBe("created");
    // Both tickets point to one contact record, so a returning customer is recognised.
    expect(await db.select().from(contacts)).toHaveLength(1);
  });

  it("can join an existing group when added", async () => {
    const { event, seller } = await makeEvent();
    const first = await created(
      createSale(as(seller), event.id, { ticketType: "seated", payment: "unpaid", people: [{ name: "Maria Rivera" }] }),
    );
    const second = await created(
      createSale(as(seller), event.id, {
        ticketType: "seated",
        payment: "unpaid",
        people: [{ name: "Tom Lee" }],
        groupId: first.groupId,
      }),
    );
    expect(second.groupId).toBe(first.groupId);
    const list = await listCustomers(as(seller), event.id);
    expect(list.map((c) => c.groupName)).toEqual(["Rivera party", "Rivera party"]);
  });

  it("only admins can delete; deleting keeps the record and the rest of the group", async () => {
    const { event, admin, seller } = await makeEvent();
    const r = await created(
      createSale(as(seller), event.id, {
        ticketType: "seated",
        payment: "cash",
        people: [{ name: "Maria Rivera" }, { name: "Tom Lee" }],
      }),
    );
    await expect(deleteCustomer(as(seller), r.customerIds[0]!)).rejects.toThrow(/permission/);
    await deleteCustomer(as(admin), r.customerIds[0]!);

    const list = await listCustomers(as(admin), event.id);
    expect(list.map((c) => c.name)).toEqual(["Tom Lee"]);
    // The group is renamed after its new first member, and the payment record is kept.
    expect(list[0]?.groupName).toBe("Lee party");
    expect(await db.select().from(payments)).toHaveLength(2);
  });

  it("search finds customers by name, email or phone", async () => {
    const { event, seller } = await makeEvent();
    await created(
      createSale(as(seller), event.id, {
        ticketType: "seated",
        payment: "unpaid",
        people: [{ name: "Maria Rivera", email: "maria@example.org", phone: "212-736-5000" }],
      }),
    );
    await created(createSale(as(seller), event.id, { ticketType: "seated", payment: "unpaid", people: [{ name: "Tom Lee" }] }));
    const names = async (search: string) => (await listCustomers(as(seller), event.id, { search })).map((c) => c.name);
    expect(await names("rivera")).toEqual(["Maria Rivera"]);
    expect(await names("maria@")).toEqual(["Maria Rivera"]);
    expect(await names("736-50")).toEqual(["Maria Rivera"]);
    expect(await names("tom")).toEqual(["Tom Lee"]);
  });

  it("door staff cannot open the customer list or see contact details", async () => {
    const { event, door } = await makeEvent();
    await expect(listCustomers(as(door), event.id)).rejects.toThrow(/permission/);
  });
});

describe("Eventbrite orders entered by hand", () => {
  it("four tickets become four Paid customers in one group, credited to Eventbrite", async () => {
    const { event, admin } = await makeEvent();
    const r = await created(
      createSale(as(admin), event.id, {
        ticketType: "seated",
        payment: "eventbrite",
        eventbriteOrderNumber: "EB-1001",
        people: [{ name: "Maria Rivera", email: "maria@example.org" }, { name: "Tom Lee" }, { name: "" }, { name: "" }],
      }),
    );
    const rows = await listCustomers(as(admin), event.id);
    expect(rows).toHaveLength(4);
    expect(new Set(rows.map((c) => c.groupId))).toEqual(new Set([r.groupId]));
    expect(rows.every((c) => c.paymentStatus === "paid" && c.channel === "eventbrite")).toBe(true);
    expect(rows.filter((c) => c.name === "Guest of Maria Rivera")).toHaveLength(2);
    const pays = await db.select().from(payments);
    expect(pays.every((p) => p.method === "eventbrite")).toBe(true);
    const dbRows = await db.select().from(customers);
    expect(dbRows.every((c) => c.soldBy === null)).toBe(true);
  });

  it("warns when the same order number is entered twice", async () => {
    const { event, admin } = await makeEvent();
    const input = {
      ticketType: "seated" as const,
      payment: "eventbrite" as const,
      eventbriteOrderNumber: "EB-1001",
      people: [{ name: "Maria Rivera" }],
    };
    await created(createSale(as(admin), event.id, input));
    const again = await createSale(as(admin), event.id, input);
    expect(again.status).toBe("duplicate");
    if (again.status === "duplicate") expect(again.matches[0]?.kind).toBe("eventbrite_order");
  });

  it("ticket sellers cannot choose Eventbrite", async () => {
    const { event, seller } = await makeEvent();
    await expect(
      createSale(as(seller), event.id, { ticketType: "seated", payment: "eventbrite", people: [{ name: "A" }] }),
    ).rejects.toThrow(/permission/);
  });
});

describe("group names", () => {
  it('are automatic ("Rivera party", "Rivera party 2"), can be typed, and return to automatic when cleared', async () => {
    const { event, seller } = await makeEvent();
    const a = await created(
      createSale(as(seller), event.id, { ticketType: "seated", payment: "unpaid", people: [{ name: "Maria Rivera" }] }),
    );
    const b = await created(
      createSale(as(seller), event.id, { ticketType: "seated", payment: "unpaid", people: [{ name: "Luis Rivera" }] }),
    );
    const name = async (id: string) => (await db.select().from(groups).where(eq(groups.id, id)))[0]!.name;
    expect(await name(a.groupId)).toBe("Rivera party");
    expect(await name(b.groupId)).toBe("Rivera party 2");

    await renameGroup(as(seller), b.groupId, "The Cousins");
    expect(await name(b.groupId)).toBe("The Cousins");
    // A typed name never changes on its own.
    await updateCustomer(as(seller), b.customerIds[0]!, { name: "Luis Moreno" });
    expect(await name(b.groupId)).toBe("The Cousins");

    await renameGroup(as(seller), b.groupId, "");
    expect(await name(b.groupId)).toBe("Moreno party");
  });

  it("an automatic name follows the first member", async () => {
    const { event, seller } = await makeEvent();
    const a = await created(
      createSale(as(seller), event.id, { ticketType: "seated", payment: "unpaid", people: [{ name: "Maria Rivera" }] }),
    );
    await updateCustomer(as(seller), a.customerIds[0]!, { name: "Maria Santos" });
    const [g] = await db.select().from(groups).where(eq(groups.id, a.groupId));
    expect(g?.name).toBe("Santos party");
  });
});

describe("taking cash for unpaid tickets", () => {
  it("marks them Paid and records the payment", async () => {
    const { event, seller, door } = await makeEvent();
    const r = await created(
      createSale(as(seller), event.id, { ticketType: "seated", payment: "unpaid", people: [{ name: "A" }, { name: "B" }] }),
    );
    await takeCashPayment(as(door), event.id, r.customerIds);
    const rows = await db.select().from(customers);
    expect(rows.every((c) => c.paymentStatus === "paid")).toBe(true);
    await expect(takeCashPayment(as(door), event.id, r.customerIds)).rejects.toThrow(/unpaid/);
  });
});
