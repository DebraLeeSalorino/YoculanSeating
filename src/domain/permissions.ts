/**
 * Who may do what, from the roles table in section 10.1 of docs/spec.md.
 * The server checks these on every action; the UI only hides what a role can't use.
 */
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { memberships } from "@/db/schema";
import { forbidden } from "@/lib/errors";

export type Role = "admin" | "ticket_seller" | "door_staff";

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin",
  ticket_seller: "Ticket seller",
  door_staff: "Door staff",
};

const CAPABILITIES = {
  editCustomers: ["admin", "ticket_seller"],
  deleteCustomers: ["admin"],
  seeContactDetails: ["admin", "ticket_seller"],
  enterEventbriteOrders: ["admin"],
  editLayout: ["admin"],
  seat: ["admin"],
  viewFloorPlan: ["admin", "ticket_seller", "door_staff"],
  emailSeats: ["admin"],
  checkIn: ["admin", "door_staff"],
  export: ["admin"],
  manageUsers: ["admin"],
  requestTable: ["ticket_seller"],
  decideTableRequests: ["admin"],
  takePayment: ["admin", "ticket_seller", "door_staff"],
  refund: ["admin"],
  compAny: ["admin"],
  compFriendsAndFamily: ["admin", "ticket_seller"],
  approveComps: ["admin"],
  seeAllSalesTotals: ["admin"],
  seeOwnSalesTotals: ["admin", "ticket_seller"],
  enterCustomerRequests: ["admin", "ticket_seller"],
  decideCustomerRequests: ["admin"],
  manageSections: ["admin"],
  seatAtDoor: ["admin", "door_staff"],
  manageEvent: ["admin"],
} as const satisfies Record<string, readonly Role[]>;

export type Capability = keyof typeof CAPABILITIES;

export function can(role: Role | null | undefined, capability: Capability): boolean {
  return !!role && (CAPABILITIES[capability] as readonly Role[]).includes(role);
}

/** The user's current role in an event, or null if they have no access. */
export async function roleIn(userId: string, eventId: string): Promise<Role | null> {
  const [row] = await db
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.eventId, eventId), isNull(memberships.removedAt)));
  return row?.role ?? null;
}

export interface Actor {
  userId: string;
}

/** Throws unless the user holds a role in the event that allows the capability. Returns the role. */
export async function authorize(actor: Actor, eventId: string, capability: Capability): Promise<Role> {
  const role = await roleIn(actor.userId, eventId);
  if (!role) throw forbidden("You don't have access to this event.");
  if (!can(role, capability)) throw forbidden();
  return role;
}

/** Throws unless the user holds any role in the event. */
export async function requireMember(actor: Actor, eventId: string): Promise<Role> {
  const role = await roleIn(actor.userId, eventId);
  if (!role) throw forbidden("You don't have access to this event.");
  return role;
}
