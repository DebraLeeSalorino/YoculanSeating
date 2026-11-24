import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { checkouts, customers, payments } from "@/db/schema";
import { getCapacity } from "@/domain/capacity";
import { createSale, takeCashPayment, type SaleInput } from "@/domain/customers";
import { refundTickets } from "@/domain/refunds";
import {
  addSandboxTestTerminal,
  cancelCheckout,
  checkTerminalPairing,
  closeUnpayableLinks,
  handleSquareWebhook,
  listOversold,
  paymentOptions,
  setSquareLocation,
  startCheckout,
  startTerminalPairing,
  syncCheckout,
} from "@/domain/square";
import { FakeSquare, getSquare, SANDBOX_TEST_DEVICE } from "@/lib/square/client";
import { as, mailer, makeEvent } from "./helpers";

const fake = () => getSquare() as FakeSquare;
const people = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `Person ${i + 1}` }));

async function sale(actor: { id: string }, eventId: string, input: SaleInput) {
  const r = await createSale(as(actor), eventId, input);
  if (r.status !== "created") throw new Error("expected created");
  return r;
}

/** An event with Square set up: a location and the sandbox test terminal. */
async function squareEvent(overrides = {}) {
  const ctx = await makeEvent(overrides);
  await setSquareLocation(as(ctx.admin), ctx.event.id, "LOC_FAKE");
  await addSandboxTestTerminal(as(ctx.admin), ctx.event.id);
  return ctx;
}

async function statusOf(ids: string[]) {
  const rows = await db.select().from(customers);
  return ids.map((id) => rows.find((r) => r.id === id)!.paymentStatus);
}

const terminal = { kind: "terminal" as const, deviceId: SANDBOX_TEST_DEVICE.deviceId };

describe("charging on a Square Terminal", () => {
  it("three tickets charged on a terminal are saved as Paid with Square's reference", async () => {
    const { event, seller } = await squareEvent();
    const r = await sale(seller, event.id, { ticketType: "seated", payment: "unpaid", people: people(3) });
    const checkoutId = await startCheckout(as(seller), event.id, r.customerIds, terminal);

    const [c] = await db.select().from(checkouts).where(eq(checkouts.id, checkoutId));
    expect(c).toMatchObject({ amountCents: 30000, status: "pending", kind: "terminal" });
    expect(fake().terminal.get(c!.squareCheckoutId!)?.amount).toEqual({ amountCents: 30000, currency: "USD" });
    expect(await statusOf(r.customerIds)).toEqual(["unpaid", "unpaid", "unpaid"]);
    expect(await syncCheckout(checkoutId)).toBe("pending");

    const squarePaymentId = fake().completeTerminal(c!.squareCheckoutId!);
    expect(await syncCheckout(checkoutId)).toBe("completed");
    expect(await statusOf(r.customerIds)).toEqual(["paid", "paid", "paid"]);
    const pays = await db.select().from(payments);
    expect(pays.map((p) => [p.method, p.amountCents, p.squareReference, p.takenBy])).toEqual(
      r.customerIds.map(() => ["square_terminal", 10000, squarePaymentId, seller.id]),
    );
    // Checking again records nothing twice.
    expect(await syncCheckout(checkoutId)).toBe("completed");
    expect(await db.select().from(payments)).toHaveLength(3);
  });

  it("a declined card leaves the tickets Unpaid, and they can be paid another way", async () => {
    const { event, seller } = await squareEvent();
    const r = await sale(seller, event.id, { ticketType: "seated", payment: "unpaid", people: people(1) });
    const checkoutId = await startCheckout(as(seller), event.id, r.customerIds, terminal);
    const [c] = await db.select().from(checkouts).where(eq(checkouts.id, checkoutId));
    fake().declineTerminal(c!.squareCheckoutId!);
    expect(await syncCheckout(checkoutId)).toBe("canceled");
    expect(await statusOf(r.customerIds)).toEqual(["unpaid"]);
    await takeCashPayment(as(seller), event.id, r.customerIds);
    expect(await statusOf(r.customerIds)).toEqual(["paid"]);
  });

  it("tickets already being paid for can't be charged again or paid in cash until canceled", async () => {
    const { event, seller } = await squareEvent();
    const r = await sale(seller, event.id, { ticketType: "seated", payment: "unpaid", people: people(2) });
    const checkoutId = await startCheckout(as(seller), event.id, r.customerIds, terminal);
    await expect(startCheckout(as(seller), event.id, [r.customerIds[0]!], terminal)).rejects.toThrow(/already in progress/);
    await expect(takeCashPayment(as(seller), event.id, r.customerIds)).rejects.toThrow(/already in progress/);
    await cancelCheckout(as(seller), checkoutId);
    const [c] = await db.select().from(checkouts).where(eq(checkouts.id, checkoutId));
    expect(c?.status).toBe("canceled");
    expect(fake().terminal.get(c!.squareCheckoutId!)?.status).toBe("CANCELED");
    await takeCashPayment(as(seller), event.id, r.customerIds);
  });

  it("refuses to start a charge that would exceed the tickets left, before any money is taken", async () => {
    const { event, seller } = await squareEvent({ generalSeatsOverride: 2 });
    const r = await sale(seller, event.id, { ticketType: "seated", payment: "unpaid", people: people(3) });
    await expect(startCheckout(as(seller), event.id, r.customerIds, terminal)).rejects.toThrow(/Only 2 seated/);
    expect(fake().terminal.size).toBe(0);
  });

  it("if a charge is taken after tickets ran out, it is recorded and flagged for an admin", async () => {
    const { event, admin, seller } = await squareEvent({ generalSeatsOverride: 1 });
    const a = await sale(seller, event.id, { ticketType: "seated", payment: "unpaid", people: people(1) });
    const checkoutId = await startCheckout(as(seller), event.id, a.customerIds, terminal);
    await sale(seller, event.id, { ticketType: "seated", payment: "cash", people: people(1) });
    const [c] = await db.select().from(checkouts).where(eq(checkouts.id, checkoutId));
    fake().completeTerminal(c!.squareCheckoutId!);
    await syncCheckout(checkoutId);
    expect(await statusOf(a.customerIds)).toEqual(["paid"]);
    expect((await listOversold(as(admin), event.id)).map((o) => o.id)).toEqual([checkoutId]);
  });

  it("only paired terminals can be used, and door staff can take card payments", async () => {
    const { event, seller, door } = await squareEvent();
    const r = await sale(seller, event.id, { ticketType: "seated", payment: "unpaid", people: people(1) });
    await expect(
      startCheckout(as(seller), event.id, r.customerIds, { kind: "terminal", deviceId: "not-paired" }),
    ).rejects.toThrow(/paired/);
    await startCheckout(as(door), event.id, r.customerIds, terminal);
  });

  it("needs a Square location first", async () => {
    const { event, seller } = await makeEvent();
    const r = await sale(seller, event.id, { ticketType: "seated", payment: "unpaid", people: people(1) });
    expect((await paymentOptions(as(seller), event.id)).squareReady).toBe(false);
    await expect(startCheckout(as(seller), event.id, r.customerIds, { kind: "link" })).rejects.toThrow(/location/);
  });
});

describe("payment links", () => {
  it("emails a link; the tickets become Paid only when the buyer pays", async () => {
    const { event, seller } = await squareEvent();
    const r = await sale(seller, event.id, { ticketType: "seated", payment: "unpaid", people: people(2) });
    const checkoutId = await startCheckout(as(seller), event.id, r.customerIds, { kind: "link", buyerEmail: "ann@buyer.test" });
    const [c] = await db.select().from(checkouts).where(eq(checkouts.id, checkoutId));
    expect(c?.url).toMatch(/^https:/);
    expect(mailer().last("ann@buyer.test")?.text).toContain(c!.url!);

    expect(await syncCheckout(checkoutId)).toBe("pending");
    fake().payLink(c!.squareCheckoutId!);
    expect(await syncCheckout(checkoutId)).toBe("completed");
    expect(await statusOf(r.customerIds)).toEqual(["paid", "paid"]);
    expect((await db.select().from(payments)).every((p) => p.method === "square_link")).toBe(true);
  });

  it("open links are closed when seated tickets sell out", async () => {
    const { event, seller } = await squareEvent({ generalSeatsOverride: 2 });
    const r = await sale(seller, event.id, { ticketType: "seated", payment: "unpaid", people: people(1) });
    const checkoutId = await startCheckout(as(seller), event.id, r.customerIds, { kind: "link" });
    await sale(seller, event.id, { ticketType: "seated", payment: "cash", people: people(2) });
    await closeUnpayableLinks(event.id);
    const [c] = await db.select().from(checkouts).where(eq(checkouts.id, checkoutId));
    expect(c).toMatchObject({ status: "canceled", cancelReason: "Tickets sold out" });
    expect(fake().links.get(c!.squareCheckoutId!)?.deleted).toBe(true);
  });

  it("a Square error leaves nothing half-started", async () => {
    const { event, seller } = await squareEvent();
    const r = await sale(seller, event.id, { ticketType: "seated", payment: "unpaid", people: people(1) });
    fake().failNext = "Location is not active";
    await expect(startCheckout(as(seller), event.id, r.customerIds, { kind: "link" })).rejects.toThrow(/Square: Location is not active/);
    // The tickets are free to pay another way.
    await startCheckout(as(seller), event.id, r.customerIds, { kind: "link" });
  });
});

describe("cash recorded in Square", () => {
  it("cash sales are also recorded in Square, so all takings are in one place", async () => {
    const { event, seller } = await squareEvent();
    await sale(seller, event.id, { ticketType: "seated", payment: "cash", people: people(2) });
    expect(fake().cash.map((c) => c.amount.amountCents)).toEqual([10000, 10000]);
    const pays = await db.select().from(payments);
    expect(pays.every((p) => p.squareReference?.startsWith("cash_") && !p.squarePending)).toBe(true);
  });

  it("cash taken before a location is chosen is recorded once it is", async () => {
    const { event, admin, seller } = await makeEvent();
    await sale(seller, event.id, { ticketType: "seated", payment: "cash", people: people(1) });
    expect(fake().cash).toHaveLength(0);
    expect((await db.select().from(payments))[0]?.squarePending).toBe(true);
    await setSquareLocation(as(admin), event.id, "LOC_FAKE");
    expect(fake().cash).toHaveLength(1);
  });

  it("if Square is unreachable the cash sale still succeeds and waits to be recorded", async () => {
    const { event, seller } = await squareEvent();
    fake().failNext = "Service unavailable";
    await sale(seller, event.id, { ticketType: "seated", payment: "cash", people: people(1) });
    expect((await db.select().from(payments))[0]?.squarePending).toBe(true);
  });
});

describe("Square refunds", () => {
  it("an admin's refund of a Square payment is sent to Square without opening Square", async () => {
    const { event, admin, seller } = await squareEvent();
    const r = await sale(seller, event.id, { ticketType: "seated", payment: "unpaid", people: people(2) });
    const checkoutId = await startCheckout(as(seller), event.id, r.customerIds, terminal);
    const [c] = await db.select().from(checkouts).where(eq(checkouts.id, checkoutId));
    const squarePaymentId = fake().completeTerminal(c!.squareCheckoutId!);
    await syncCheckout(checkoutId);
    const before = (await getCapacity(event.id)).seatedLeft;

    await refundTickets(as(admin), event.id, [r.customerIds[0]!], "Charged the wrong person");
    expect(fake().refunds).toMatchObject([
      { paymentId: squarePaymentId, amount: { amountCents: 10000, currency: "USD" }, reason: "Charged the wrong person" },
    ]);
    expect(await statusOf(r.customerIds)).toEqual(["refunded", "paid"]);
    const refund = (await db.select().from(payments)).find((p) => p.kind === "refund");
    expect(refund).toMatchObject({ method: "square_terminal", squareReference: fake().refunds[0]!.id });
    expect((await getCapacity(event.id)).seatedLeft).toBe(before + 1);
  });

  it("if Square refuses, nothing is recorded as refunded", async () => {
    const { event, admin, seller } = await squareEvent();
    const r = await sale(seller, event.id, { ticketType: "seated", payment: "unpaid", people: people(1) });
    const checkoutId = await startCheckout(as(seller), event.id, r.customerIds, terminal);
    const [c] = await db.select().from(checkouts).where(eq(checkouts.id, checkoutId));
    fake().completeTerminal(c!.squareCheckoutId!);
    await syncCheckout(checkoutId);
    fake().failNext = "Insufficient funds in account";
    await expect(refundTickets(as(admin), event.id, r.customerIds, "Oops")).rejects.toThrow(/Square refused/);
    expect(await statusOf(r.customerIds)).toEqual(["paid"]);
  });
});

describe("terminals", () => {
  it("pairing gives a code, and the terminal is added once signed in", async () => {
    const { event, admin, seller } = await makeEvent();
    await setSquareLocation(as(admin), event.id, "LOC_FAKE");
    await expect(startTerminalPairing(as(seller), event.id, "Door")).rejects.toThrow(/permission/);
    const p = await startTerminalPairing(as(admin), event.id, "Door");
    expect(p.code).toBe("ABCDEF");
    expect(await checkTerminalPairing(as(admin), event.id, p.codeId, "Door")).toBe("UNPAIRED");
    fake().pairCode(p.codeId, "device-123");
    expect(await checkTerminalPairing(as(admin), event.id, p.codeId, "Door")).toBe("PAIRED");
    expect((await paymentOptions(as(seller), event.id)).terminals).toEqual([{ deviceId: "device-123", name: "Door" }]);
  });
});

describe("Square notifications", () => {
  const sign = (body: string) =>
    createHmac("sha256", "test-signature-key").update("http://localhost:3000/api/square/webhook" + body).digest("base64");

  it("a signed notification completes the matching checkout; an unsigned one is ignored", async () => {
    const { event, seller } = await squareEvent();
    const r = await sale(seller, event.id, { ticketType: "seated", payment: "unpaid", people: people(1) });
    const checkoutId = await startCheckout(as(seller), event.id, r.customerIds, terminal);
    const [c] = await db.select().from(checkouts).where(eq(checkouts.id, checkoutId));
    fake().completeTerminal(c!.squareCheckoutId!);
    const body = JSON.stringify({ type: "terminal.checkout.updated", data: { object: { checkout: { id: c!.squareCheckoutId } } } });

    expect(await handleSquareWebhook(body, "forged")).toBe(401);
    expect(await statusOf(r.customerIds)).toEqual(["unpaid"]);
    expect(await handleSquareWebhook(body, sign(body))).toBe(200);
    expect(await statusOf(r.customerIds)).toEqual(["paid"]);
  });
});
