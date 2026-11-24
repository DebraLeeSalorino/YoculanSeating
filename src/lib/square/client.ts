/**
 * Square connection (spec section 3.4). The app starts every charge itself; card numbers never
 * pass through it. Two implementations: the real HTTP API, and an in-memory fake for tests.
 *
 * Configuration (environment variables, never the database):
 * - SQUARE_ENVIRONMENT: "sandbox" or "production". Unset means Square is not connected.
 * - SQUARE_ACCESS_TOKEN: the access token. Kept in the host's secret settings.
 * - SQUARE_WEBHOOK_SIGNATURE_KEY: verifies notifications from Square (set once the app is online).
 * - SQUARE_MODE=fake: use the in-memory fake (tests).
 */
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export interface Money {
  amountCents: number;
  currency: string;
}

export interface SquareLocation {
  id: string;
  name: string;
  currency: string;
  status: string;
}

export type TerminalStatus = "PENDING" | "IN_PROGRESS" | "CANCEL_REQUESTED" | "CANCELED" | "COMPLETED";

export interface TerminalCheckoutResult {
  id: string;
  status: TerminalStatus;
  paymentIds: string[];
  cancelReason?: string;
}

export interface PaymentLinkResult {
  id: string;
  orderId: string;
  url: string;
}

export interface OrderPaymentState {
  /** Payment ids of completed payments on the order. Empty until the buyer pays. */
  completedPaymentIds: string[];
  /** True once the order is fully paid. */
  paid: boolean;
}

export interface DeviceCodeResult {
  id: string;
  code: string;
  status: "UNKNOWN" | "UNPAIRED" | "PAIRED" | "EXPIRED";
  deviceId?: string;
}

export interface SquareGateway {
  readonly environment: "sandbox" | "production" | "fake";
  listLocations(): Promise<SquareLocation[]>;
  createTerminalCheckout(input: {
    idempotencyKey: string;
    amount: Money;
    deviceId: string;
    referenceId: string;
    note: string;
  }): Promise<TerminalCheckoutResult>;
  getTerminalCheckout(id: string): Promise<TerminalCheckoutResult>;
  cancelTerminalCheckout(id: string): Promise<void>;
  createPaymentLink(input: {
    idempotencyKey: string;
    amount: Money;
    locationId: string;
    name: string;
    note: string;
    buyerEmail?: string | null;
  }): Promise<PaymentLinkResult>;
  getOrderPaymentState(orderId: string): Promise<OrderPaymentState>;
  deletePaymentLink(id: string): Promise<void>;
  recordCashPayment(input: {
    idempotencyKey: string;
    amount: Money;
    locationId: string;
    referenceId: string;
    note: string;
  }): Promise<string>;
  refundPayment(input: { idempotencyKey: string; paymentId: string; amount: Money; reason: string }): Promise<string>;
  createDeviceCode(input: { idempotencyKey: string; locationId: string; name: string }): Promise<DeviceCodeResult>;
  getDeviceCode(id: string): Promise<DeviceCodeResult>;
}

export class SquareError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "SquareError";
  }
}

const API_VERSION = "2024-10-17";

class HttpSquare implements SquareGateway {
  constructor(
    readonly environment: "sandbox" | "production",
    private readonly token: string,
  ) {}

  private get base() {
    return this.environment === "production" ? "https://connect.squareup.com" : "https://connect.squareupsandbox.com";
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(this.base + path, {
      method,
      headers: {
        "Square-Version": API_VERSION,
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    const json = (await res.json().catch(() => ({}))) as { errors?: { code?: string; detail?: string }[] } & T;
    if (!res.ok || json.errors?.length) {
      const e = json.errors?.[0];
      throw new SquareError(e?.detail ?? `Square returned ${res.status}`, e?.code);
    }
    return json;
  }

  async listLocations() {
    const r = await this.call<{ locations?: { id: string; name: string; currency: string; status: string }[] }>("GET", "/v2/locations");
    return (r.locations ?? []).map((l) => ({ id: l.id, name: l.name, currency: l.currency, status: l.status }));
  }

  private static terminal(c: { id: string; status: TerminalStatus; payment_ids?: string[]; cancel_reason?: string }): TerminalCheckoutResult {
    return { id: c.id, status: c.status, paymentIds: c.payment_ids ?? [], cancelReason: c.cancel_reason };
  }

  async createTerminalCheckout(i: Parameters<SquareGateway["createTerminalCheckout"]>[0]) {
    const r = await this.call<{ checkout: Parameters<typeof HttpSquare.terminal>[0] }>("POST", "/v2/terminals/checkouts", {
      idempotency_key: i.idempotencyKey,
      checkout: {
        amount_money: { amount: i.amount.amountCents, currency: i.amount.currency },
        reference_id: i.referenceId,
        note: i.note.slice(0, 250),
        device_options: { device_id: i.deviceId },
      },
    });
    return HttpSquare.terminal(r.checkout);
  }

  async getTerminalCheckout(id: string) {
    const r = await this.call<{ checkout: Parameters<typeof HttpSquare.terminal>[0] }>("GET", `/v2/terminals/checkouts/${encodeURIComponent(id)}`);
    return HttpSquare.terminal(r.checkout);
  }

  async cancelTerminalCheckout(id: string) {
    await this.call("POST", `/v2/terminals/checkouts/${encodeURIComponent(id)}/cancel`);
  }

  async createPaymentLink(i: Parameters<SquareGateway["createPaymentLink"]>[0]) {
    const r = await this.call<{ payment_link: { id: string; order_id: string; url: string } }>("POST", "/v2/online-checkout/payment-links", {
      idempotency_key: i.idempotencyKey,
      quick_pay: {
        name: i.name.slice(0, 255),
        price_money: { amount: i.amount.amountCents, currency: i.amount.currency },
        location_id: i.locationId,
      },
      payment_note: i.note.slice(0, 500),
      ...(i.buyerEmail ? { pre_populated_data: { buyer_email: i.buyerEmail } } : {}),
    });
    return { id: r.payment_link.id, orderId: r.payment_link.order_id, url: r.payment_link.url };
  }

  async getOrderPaymentState(orderId: string): Promise<OrderPaymentState> {
    const r = await this.call<{
      order: { state: string; tenders?: { payment_id?: string }[]; net_amount_due_money?: { amount: number } };
    }>("GET", `/v2/orders/${encodeURIComponent(orderId)}`);
    const ids = (r.order.tenders ?? []).map((t) => t.payment_id).filter((id): id is string => !!id);
    const completed: string[] = [];
    for (const id of ids) {
      const p = await this.call<{ payment: { status: string } }>("GET", `/v2/payments/${encodeURIComponent(id)}`);
      if (p.payment.status === "COMPLETED") completed.push(id);
    }
    const due = r.order.net_amount_due_money?.amount ?? 0;
    return { completedPaymentIds: completed, paid: completed.length > 0 && due === 0 };
  }

  async deletePaymentLink(id: string) {
    await this.call("DELETE", `/v2/online-checkout/payment-links/${encodeURIComponent(id)}`);
  }

  async recordCashPayment(i: Parameters<SquareGateway["recordCashPayment"]>[0]) {
    const money = { amount: i.amount.amountCents, currency: i.amount.currency };
    const r = await this.call<{ payment: { id: string } }>("POST", "/v2/payments", {
      idempotency_key: i.idempotencyKey,
      source_id: "CASH",
      amount_money: money,
      cash_details: { buyer_supplied_money: money },
      location_id: i.locationId,
      reference_id: i.referenceId,
      note: i.note.slice(0, 500),
    });
    return r.payment.id;
  }

  async refundPayment(i: Parameters<SquareGateway["refundPayment"]>[0]) {
    const r = await this.call<{ refund: { id: string } }>("POST", "/v2/refunds", {
      idempotency_key: i.idempotencyKey,
      payment_id: i.paymentId,
      amount_money: { amount: i.amount.amountCents, currency: i.amount.currency },
      reason: i.reason.slice(0, 192),
    });
    return r.refund.id;
  }

  private static device(c: { id: string; code: string; status: DeviceCodeResult["status"]; device_id?: string }): DeviceCodeResult {
    return { id: c.id, code: c.code, status: c.status, deviceId: c.device_id };
  }

  async createDeviceCode(i: Parameters<SquareGateway["createDeviceCode"]>[0]) {
    const r = await this.call<{ device_code: Parameters<typeof HttpSquare.device>[0] }>("POST", "/v2/devices/codes", {
      idempotency_key: i.idempotencyKey,
      device_code: { product_type: "TERMINAL_API", location_id: i.locationId, name: i.name.slice(0, 128) },
    });
    return HttpSquare.device(r.device_code);
  }

  async getDeviceCode(id: string) {
    const r = await this.call<{ device_code: Parameters<typeof HttpSquare.device>[0] }>("GET", `/v2/devices/codes/${encodeURIComponent(id)}`);
    return HttpSquare.device(r.device_code);
  }
}

/** In-memory Square used by tests. Tests drive outcomes with complete/cancel/pay helpers. */
export class FakeSquare implements SquareGateway {
  readonly environment = "fake" as const;
  terminal = new Map<string, TerminalCheckoutResult & { amount: Money; deviceId: string; referenceId: string }>();
  links = new Map<string, PaymentLinkResult & { amount: Money; deleted: boolean; paidPaymentId?: string }>();
  cash: { id: string; amount: Money; referenceId: string }[] = [];
  refunds: { id: string; paymentId: string; amount: Money; reason: string; idempotencyKey: string }[] = [];
  codes = new Map<string, DeviceCodeResult>();
  failNext: string | null = null;
  private seq = 0;
  private id(prefix: string) {
    return `${prefix}_${++this.seq}`;
  }
  private maybeFail() {
    if (this.failNext) {
      const msg = this.failNext;
      this.failNext = null;
      throw new SquareError(msg);
    }
  }

  async listLocations() {
    return [{ id: "LOC_FAKE", name: "Fake location", currency: "USD", status: "ACTIVE" }];
  }
  async createTerminalCheckout(i: Parameters<SquareGateway["createTerminalCheckout"]>[0]) {
    this.maybeFail();
    const c = { id: this.id("tc"), status: "PENDING" as TerminalStatus, paymentIds: [], amount: i.amount, deviceId: i.deviceId, referenceId: i.referenceId };
    this.terminal.set(c.id, c);
    return { id: c.id, status: c.status, paymentIds: [] };
  }
  async getTerminalCheckout(id: string) {
    const c = this.terminal.get(id);
    if (!c) throw new SquareError("Not found", "NOT_FOUND");
    return { id: c.id, status: c.status, paymentIds: c.paymentIds, cancelReason: c.cancelReason };
  }
  async cancelTerminalCheckout(id: string) {
    const c = this.terminal.get(id);
    if (c && c.status !== "COMPLETED") Object.assign(c, { status: "CANCELED", cancelReason: "SELLER_CANCELED" });
  }
  completeTerminal(id: string): string {
    const paymentId = this.id("pay");
    Object.assign(this.terminal.get(id)!, { status: "COMPLETED", paymentIds: [paymentId] });
    return paymentId;
  }
  declineTerminal(id: string) {
    Object.assign(this.terminal.get(id)!, { status: "CANCELED", cancelReason: "BUYER_CANCELED" });
  }
  async createPaymentLink(i: Parameters<SquareGateway["createPaymentLink"]>[0]) {
    this.maybeFail();
    const l = { id: this.id("link"), orderId: this.id("order"), url: `https://square.example/pay/${this.seq}`, amount: i.amount, deleted: false };
    this.links.set(l.id, l);
    return { id: l.id, orderId: l.orderId, url: l.url };
  }
  async getOrderPaymentState(orderId: string) {
    const l = [...this.links.values()].find((x) => x.orderId === orderId);
    if (!l) throw new SquareError("Not found", "NOT_FOUND");
    return { completedPaymentIds: l.paidPaymentId ? [l.paidPaymentId] : [], paid: !!l.paidPaymentId };
  }
  payLink(linkId: string): string {
    const l = this.links.get(linkId)!;
    l.paidPaymentId = this.id("pay");
    return l.paidPaymentId;
  }
  async deletePaymentLink(id: string) {
    const l = this.links.get(id);
    if (l) l.deleted = true;
  }
  async recordCashPayment(i: Parameters<SquareGateway["recordCashPayment"]>[0]) {
    this.maybeFail();
    const id = this.id("cash");
    this.cash.push({ id, amount: i.amount, referenceId: i.referenceId });
    return id;
  }
  async refundPayment(i: Parameters<SquareGateway["refundPayment"]>[0]) {
    this.maybeFail();
    const existing = this.refunds.find((r) => r.idempotencyKey === i.idempotencyKey);
    if (existing) return existing.id;
    const id = this.id("refund");
    this.refunds.push({ id, paymentId: i.paymentId, amount: i.amount, reason: i.reason, idempotencyKey: i.idempotencyKey });
    return id;
  }
  async createDeviceCode(i: Parameters<SquareGateway["createDeviceCode"]>[0]) {
    const c: DeviceCodeResult = { id: this.id("code"), code: "ABCDEF", status: "UNPAIRED" };
    this.codes.set(c.id, c);
    void i;
    return c;
  }
  async getDeviceCode(id: string) {
    return this.codes.get(id)!;
  }
  pairCode(id: string, deviceId: string) {
    Object.assign(this.codes.get(id)!, { status: "PAIRED", deviceId });
  }
  reset() {
    this.terminal.clear();
    this.links.clear();
    this.codes.clear();
    this.cash = [];
    this.refunds = [];
    this.failNext = null;
  }
}

const globalForSquare = globalThis as unknown as { __square?: SquareGateway | null };

/** The configured Square connection, or null when Square isn't set up. */
export function getSquare(): SquareGateway | null {
  if (globalForSquare.__square !== undefined) return globalForSquare.__square;
  let gw: SquareGateway | null = null;
  if (process.env.SQUARE_MODE === "fake") gw = new FakeSquare();
  else {
    const env = process.env.SQUARE_ENVIRONMENT;
    const token = process.env.SQUARE_ACCESS_TOKEN;
    if ((env === "sandbox" || env === "production") && token) gw = new HttpSquare(env, token);
  }
  globalForSquare.__square = gw;
  return gw;
}

/** Sandbox test terminal that approves card payments up to $25 (Square's sandbox testing docs). */
export const SANDBOX_TEST_DEVICE = { deviceId: "9fa747a2-25ff-48ee-b078-04381f7c828f", name: "Sandbox test terminal (approves up to $25)" };

/** Checks the signature Square puts on webhook notifications. */
export function verifySquareSignature(body: string, signature: string | null, notificationUrl: string, key: string): boolean {
  if (!signature) return false;
  const expected = createHmac("sha256", key).update(notificationUrl + body).digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const newIdempotencyKey = () => randomUUID();
