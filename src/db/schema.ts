/**
 * Database schema. Mirrors section 8 of docs/spec.md, plus the tables
 * sign-in needs (sessions and one-time tokens).
 *
 * Conventions:
 * - Every record has id, createdAt, updatedAt and updatedBy (the user who last changed it).
 * - Money is stored as whole cents.
 * - Rows that the spec says must be kept (payments, customers with history) are never hard-deleted.
 */
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  real,
  jsonb,
  uniqueIndex,
  index,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const id = () => uuid("id").primaryKey().defaultRandom();
const stamps = () => ({
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid("updated_by").references((): AnyPgColumn => users.id),
});

// ---------- Enums ----------

export const roleEnum = pgEnum("role", ["admin", "ticket_seller", "door_staff"]);
export const unitEnum = pgEnum("unit", ["feet", "metres"]);
export const outlineEnum = pgEnum("room_outline", ["oval", "rectangle"]);
export const fillStyleEnum = pgEnum("fill_style", ["fill_tables", "spread_evenly"]);
export const eventStatusEnum = pgEnum("event_status", ["live", "closed"]);
export const ticketTypeEnum = pgEnum("ticket_type", ["seated", "standing"]);
export const paymentStatusEnum = pgEnum("payment_status", [
  "paid",
  "unpaid",
  "complimentary",
  "comp_pending",
  "refunded",
]);
export const salesChannelEnum = pgEnum("sales_channel", ["app", "eventbrite"]);
export const paymentMethodEnum = pgEnum("payment_method", [
  "square_terminal",
  "square_link",
  "cash",
  "eventbrite",
]);
export const paymentKindEnum = pgEnum("payment_kind", ["payment", "refund"]);
export const tableShapeEnum = pgEnum("table_shape", ["round", "square", "rectangle"]);
export const featureShapeEnum = pgEnum("feature_shape", ["rectangle", "round"]);
export const placedByEnum = pgEnum("placed_by", ["admin", "auto"]);
export const tableRequestStatusEnum = pgEnum("table_request_status", [
  "pending",
  "approved",
  "declined",
  "cancelled",
]);
export const customerRequestStatusEnum = pgEnum("customer_request_status", [
  "open",
  "done",
  "cannot_accommodate",
]);
export const tokenKindEnum = pgEnum("token_kind", ["invite", "password_reset"]);

// ---------- Users and access ----------

/** "Admin" in the spec: any signed-in staff user. Role is per event (memberships). */
export const users = pgTable(
  "users",
  {
    id: id(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    passwordHash: text("password_hash"),
    ...stamps(),
  },
  (t) => [uniqueIndex("users_email_unique").on(sql`lower(${t.email})`)],
);

export const memberships = pgTable(
  "memberships",
  {
    id: id(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    role: roleEnum("role").notNull(),
    invitedBy: uuid("invited_by").references(() => users.id),
    /** Set when the user is removed from the event. Nothing else is deleted (section 10.1). */
    removedAt: timestamp("removed_at", { withTimezone: true }),
    ...stamps(),
  },
  (t) => [uniqueIndex("memberships_event_user").on(t.eventId, t.userId)],
);

export const sessions = pgTable("sessions", {
  id: id(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Single-use invitation and password-reset links. Only a hash of the token is stored. */
export const authTokens = pgTable("auth_tokens", {
  id: id(),
  kind: tokenKindEnum("kind").notNull(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------- Event ----------

export const events = pgTable("events", {
  id: id(),
  name: text("name").notNull(),
  date: timestamp("date", { withTimezone: true }).notNull(),
  status: eventStatusEnum("status").notNull().default("live"),
  salesOpen: boolean("sales_open").notNull().default(false),
  salesOpenAt: timestamp("sales_open_at", { withTimezone: true }),
  /** IANA time zone of the venue, e.g. "America/New_York". Times shown to buyers use it. */
  timeZone: text("time_zone").notNull().default("UTC"),
  /** ISO country used to read phone numbers typed without a country code. */
  defaultCountry: text("default_country").notNull().default("US"),
  currency: text("currency").notNull().default("USD"),
  // Room
  roomOutline: outlineEnum("room_outline").notNull().default("oval"),
  roomWidth: real("room_width"),
  roomLength: real("room_length"),
  unit: unitEnum("unit").notNull().default("feet"),
  // Tickets and capacity (section 3.6)
  seatedPriceCents: integer("seated_price_cents").notNull().default(0),
  standingPriceCents: integer("standing_price_cents").notNull().default(0),
  /** Typed-in seats on general sale, used until the floor plan is drawn. */
  generalSeatsOverride: integer("general_seats_override"),
  standingTickets: integer("standing_tickets").notNull().default(0),
  venueCapacity: integer("venue_capacity").notNull().default(1400),
  sellOutWarningPercent: integer("sell_out_warning_percent").notNull().default(90),
  // Seating and email
  fillStyle: fillStyleEnum("fill_style").notNull().default("fill_tables"),
  emailTemplate: jsonb("email_template"),
  buyerPageClosesAt: timestamp("buyer_page_closes_at", { withTimezone: true }),
  ...stamps(),
});

// ---------- People, orders, groups ----------

/** One person across all years (section 15). */
export const contacts = pgTable(
  "contacts",
  {
    id: id(),
    name: text("name").notNull(),
    phone: text("phone"),
    email: text("email"),
    ...stamps(),
  },
  (t) => [index("contacts_email").on(sql`lower(${t.email})`), index("contacts_phone").on(t.phone)],
);

export const sectionKindEnum = pgEnum("section_kind", ["general", "sponsors", "seller_ff", "committee_ff", "custom"]);

export const sections = pgTable("sections", {
  id: id(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => events.id),
  /** Stable identity for the four built-in sections, so renaming one never changes the rules. */
  kind: sectionKindEnum("kind").notNull().default("custom"),
  name: text("name").notNull(),
  colour: text("colour").notNull(),
  reserved: boolean("reserved").notNull(),
  ...stamps(),
});

export const sponsors = pgTable("sponsors", {
  id: id(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => events.id),
  name: text("name").notNull(),
  contact: text("contact"),
  confirmed: boolean("confirmed").notNull().default(true),
  ...stamps(),
});

export const groups = pgTable("groups", {
  id: id(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => events.id),
  name: text("name").notNull(),
  nameIsAutomatic: boolean("name_is_automatic").notNull().default(true),
  /** Allocation: General when both are null; otherwise a reserved section or a sponsor. */
  sectionId: uuid("section_id").references(() => sections.id),
  sponsorId: uuid("sponsor_id").references(() => sponsors.id),
  hostUserId: uuid("host_user_id").references(() => users.id),
  hostName: text("host_name"),
  ...stamps(),
});

export const orders = pgTable(
  "orders",
  {
    id: id(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id),
    channel: salesChannelEnum("channel").notNull(),
    eventbriteOrderNumber: text("eventbrite_order_number"),
    buyerName: text("buyer_name").notNull(),
    buyerEmail: text("buyer_email"),
    buyerPhone: text("buyer_phone"),
    ticketQuantity: integer("ticket_quantity").notNull(),
    ticketType: ticketTypeEnum("ticket_type").notNull(),
    soldBy: uuid("sold_by").references(() => users.id),
    buyerPageCode: text("buyer_page_code").notNull().unique(),
    ...stamps(),
  },
  (t) => [index("orders_eventbrite_number").on(t.eventId, t.eventbriteOrderNumber)],
);

export const customers = pgTable(
  "customers",
  {
    id: id(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id),
    contactId: uuid("contact_id").references(() => contacts.id),
    orderId: uuid("order_id").references(() => orders.id),
    /** 1 for the buyer, then 2, 3... for the other tickets in the order. */
    orderPosition: integer("order_position").notNull().default(1),
    groupId: uuid("group_id").references(() => groups.id),
    name: text("name").notNull(),
    /** Normalised E.164, e.g. +15551234567. */
    phone: text("phone"),
    email: text("email"),
    notes: text("notes"),
    // Ticket
    ticketType: ticketTypeEnum("ticket_type").notNull(),
    priceCents: integer("price_cents").notNull(),
    /** Cached from payment records and comp state; updated in the same transaction. */
    paymentStatus: paymentStatusEnum("payment_status").notNull(),
    soldBy: uuid("sold_by").references(() => users.id),
    compGivenBy: uuid("comp_given_by").references(() => users.id),
    compHostUserId: uuid("comp_host_user_id").references(() => users.id),
    compApprovedBy: uuid("comp_approved_by").references(() => users.id),
    // Door and email
    ticketCode: text("ticket_code").notNull().unique(),
    seatLastEmailedAt: timestamp("seat_last_emailed_at", { withTimezone: true }),
    seatLastEmailedSeatId: uuid("seat_last_emailed_seat_id"),
    checkedInAt: timestamp("checked_in_at", { withTimezone: true }),
    checkedInBy: uuid("checked_in_by").references(() => users.id),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...stamps(),
  },
  (t) => [
    index("customers_event").on(t.eventId),
    index("customers_group").on(t.groupId),
    index("customers_email").on(t.eventId, sql`lower(${t.email})`),
  ],
);

export const payments = pgTable("payments", {
  id: id(),
  customerId: uuid("customer_id")
    .notNull()
    .references(() => customers.id),
  kind: paymentKindEnum("kind").notNull(),
  amountCents: integer("amount_cents").notNull(),
  method: paymentMethodEnum("method").notNull(),
  reason: text("reason"),
  takenBy: uuid("taken_by").references(() => users.id),
  takenAt: timestamp("taken_at", { withTimezone: true }).notNull().defaultNow(),
  squareReference: text("square_reference"),
  /** Cash that should also be recorded in Square but couldn't be yet (spec 3.4). */
  squarePending: boolean("square_pending").notNull().default(false),
  ...stamps(),
});

export const checkoutKindEnum = pgEnum("checkout_kind", ["terminal", "link"]);
export const checkoutStatusEnum = pgEnum("checkout_status", ["pending", "completed", "canceled"]);

/** A card payment started in the app and waiting for Square: on a Terminal, or by payment link. */
export const checkouts = pgTable(
  "checkouts",
  {
    id: id(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id),
    kind: checkoutKindEnum("kind").notNull(),
    customerIds: jsonb("customer_ids").$type<string[]>().notNull(),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull(),
    status: checkoutStatusEnum("status").notNull().default("pending"),
    deviceId: text("device_id"),
    /** Terminal checkout id, or payment link id. */
    squareCheckoutId: text("square_checkout_id"),
    squareOrderId: text("square_order_id"),
    url: text("url"),
    squarePaymentId: text("square_payment_id"),
    cancelReason: text("cancel_reason"),
    /** Paid after tickets ran out (a payment link paid late, or a race). An admin resolves it. */
    oversold: boolean("oversold").notNull().default(false),
    oversoldResolvedAt: timestamp("oversold_resolved_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...stamps(),
  },
  (t) => [
    index("checkouts_event_status").on(t.eventId, t.status),
    index("checkouts_square_checkout").on(t.squareCheckoutId),
    index("checkouts_square_order").on(t.squareOrderId),
  ],
);

// ---------- Room ----------

export const tables = pgTable(
  "tables",
  {
    id: id(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id),
    label: text("label").notNull(),
    shape: tableShapeEnum("shape").notNull(),
    width: real("width").notNull(),
    length: real("length").notNull(),
    x: real("x").notNull(),
    y: real("y").notNull(),
    angle: real("angle").notNull().default(0),
    seatCount: integer("seat_count").notNull(),
    /** Rectangle sides with no seats: any of "top", "right", "bottom", "left". */
    disabledSides: jsonb("disabled_sides").$type<string[]>().notNull().default([]),
    sectionId: uuid("section_id")
      .notNull()
      .references(() => sections.id),
    sponsorId: uuid("sponsor_id").references(() => sponsors.id),
    ...stamps(),
  },
  (t) => [uniqueIndex("tables_event_label").on(t.eventId, t.label)],
);

/** Seat positions are calculated from the table, not stored. */
export const seats = pgTable(
  "seats",
  {
    id: id(),
    tableId: uuid("table_id")
      .notNull()
      .references(() => tables.id),
    number: integer("number").notNull(),
    ...stamps(),
  },
  (t) => [uniqueIndex("seats_table_number").on(t.tableId, t.number)],
);

export const roomFeatures = pgTable("room_features", {
  id: id(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => events.id),
  type: text("type").notNull(),
  label: text("label").notNull(),
  shape: featureShapeEnum("shape").notNull(),
  width: real("width").notNull(),
  length: real("length").notNull(),
  x: real("x").notNull(),
  y: real("y").notNull(),
  angle: real("angle").notNull().default(0),
  colour: text("colour").notNull(),
  ...stamps(),
});

export const assignments = pgTable("assignments", {
  id: id(),
  customerId: uuid("customer_id")
    .notNull()
    .unique()
    .references(() => customers.id),
  seatId: uuid("seat_id")
    .notNull()
    .unique()
    .references(() => seats.id),
  locked: boolean("locked").notNull().default(true),
  placedBy: placedByEnum("placed_by").notNull(),
  placedByUser: uuid("placed_by_user").references(() => users.id),
  ...stamps(),
});

// ---------- Requests and notifications ----------

export const tableRequests = pgTable("table_requests", {
  id: id(),
  groupId: uuid("group_id")
    .notNull()
    .references(() => groups.id),
  tableId: uuid("table_id").references(() => tables.id),
  note: text("note"),
  status: tableRequestStatusEnum("status").notNull().default("pending"),
  requestedBy: uuid("requested_by").references(() => users.id),
  decidedBy: uuid("decided_by").references(() => users.id),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  reason: text("reason"),
  ...stamps(),
});

export const customerRequests = pgTable("customer_requests", {
  id: id(),
  groupId: uuid("group_id").references(() => groups.id),
  customerId: uuid("customer_id").references(() => customers.id),
  needs: jsonb("needs").$type<string[]>().notNull().default([]),
  text: text("text"),
  status: customerRequestStatusEnum("status").notNull().default("open"),
  note: text("note"),
  receivedAfterSeating: boolean("received_after_seating").notNull().default(false),
  enteredBy: uuid("entered_by").references(() => users.id),
  decidedBy: uuid("decided_by").references(() => users.id),
  ...stamps(),
});

export const notifications = pgTable("notifications", {
  id: id(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => events.id),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  type: text("type").notNull(),
  subjectTable: text("subject_table"),
  subjectId: uuid("subject_id"),
  read: boolean("read").notNull().default(false),
  emailed: boolean("emailed").notNull().default(false),
  ...stamps(),
});

export const squareConnections = pgTable("square_connections", {
  id: id(),
  eventId: uuid("event_id")
    .notNull()
    .unique()
    .references(() => events.id),
  // The access token is not stored here: it lives in the host's secret settings (SQUARE_ACCESS_TOKEN),
  // which are encrypted and never shown after setup (spec section 8).
  locationId: text("location_id"),
  pairedTerminals: jsonb("paired_terminals").$type<{ deviceId: string; name: string }[]>().notNull().default([]),
  ...stamps(),
});
