/**
 * Accounts, sessions, invitations, password reset and roles (sections 10 and 10.1).
 */
import { and, eq, gt, isNull, sql, ne } from "drizzle-orm";
import { db } from "@/db";
import { authTokens, events, memberships, sessions, users } from "@/db/schema";
import { conflict, forbidden, invalid, notFound } from "@/lib/errors";
import { hashPassword, passwordProblem, verifyPassword } from "@/lib/auth/password";
import { hashToken, newToken } from "@/lib/auth/tokens";
import { appUrl, getMailer } from "@/lib/mail/mailer";
import { authorize, ROLE_LABELS, type Actor, type Role } from "./permissions";

export const SESSION_DAYS = 30;
export const RESET_LINK_MINUTES = 60;
export const INVITE_LINK_DAYS = 7;

const normEmail = (email: string) => email.trim().toLowerCase();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email.trim());
}

async function findUserByEmail(email: string) {
  const [user] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = ${normEmail(email)}`);
  return user;
}

// ---------- Sessions ----------

export async function createSession(userId: string): Promise<string> {
  const token = newToken();
  await db.insert(sessions).values({
    userId,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + SESSION_DAYS * 24 * 3600 * 1000),
  });
  return token;
}

export async function userForSession(token: string | undefined | null) {
  if (!token) return null;
  const [row] = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date())));
  return row ?? null;
}

export async function endSession(token: string) {
  await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
}

/** Returns a session token, or null when the email or password is wrong. */
export async function signIn(email: string, password: string): Promise<{ userId: string; token: string } | null> {
  const user = await findUserByEmail(email);
  const ok = await verifyPassword(password, user?.passwordHash ?? null);
  if (!user || !ok) return null;
  // A user removed from every event can no longer use the app.
  const [active] = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(eq(memberships.userId, user.id), isNull(memberships.removedAt)))
    .limit(1);
  if (!active) return null;
  return { userId: user.id, token: await createSession(user.id) };
}

// ---------- One-time links ----------

async function issueToken(kind: "invite" | "password_reset", userId: string, ttlMs: number, createdBy?: string) {
  const token = newToken();
  await db.insert(authTokens).values({
    kind,
    userId,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + ttlMs),
    createdBy,
  });
  return token;
}

/** Marks a token used and returns its user, or throws if it is unknown, used or expired. */
async function consumeToken(kind: "invite" | "password_reset", token: string): Promise<string> {
  const [row] = await db
    .update(authTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(authTokens.kind, kind),
        eq(authTokens.tokenHash, hashToken(token)),
        isNull(authTokens.usedAt),
        gt(authTokens.expiresAt, new Date()),
      ),
    )
    .returning({ userId: authTokens.userId });
  if (!row) throw invalid("This link has expired or has already been used. Ask for a new one.");
  return row.userId;
}

export async function tokenIsUsable(kind: "invite" | "password_reset", token: string): Promise<boolean> {
  const [row] = await db
    .select({ id: authTokens.id })
    .from(authTokens)
    .where(
      and(
        eq(authTokens.kind, kind),
        eq(authTokens.tokenHash, hashToken(token)),
        isNull(authTokens.usedAt),
        gt(authTokens.expiresAt, new Date()),
      ),
    );
  return !!row;
}

// ---------- Invitations ----------

export async function inviteUser(
  actor: Actor,
  eventId: string,
  input: { name: string; email: string; role: Role },
): Promise<{ userId: string; restored: boolean }> {
  await authorize(actor, eventId, "manageUsers");
  const name = input.name.trim();
  const email = input.email.trim();
  if (!name) throw invalid("Enter the person's name.");
  if (!isValidEmail(email)) throw invalid("Enter a valid email address.");

  const [event] = await db.select({ name: events.name }).from(events).where(eq(events.id, eventId));
  if (!event) throw notFound("The event");

  let user = await findUserByEmail(email);
  if (!user) {
    [user] = await db.insert(users).values({ name, email, updatedBy: actor.userId }).returning();
  }

  const [existing] = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.userId, user.id), eq(memberships.eventId, eventId)));
  if (existing && !existing.removedAt) throw conflict(`${user.name} already has access to this event.`);

  if (existing) {
    await db
      .update(memberships)
      .set({ role: input.role, removedAt: null, invitedBy: actor.userId, updatedAt: new Date(), updatedBy: actor.userId })
      .where(eq(memberships.id, existing.id));
  } else {
    await db
      .insert(memberships)
      .values({ eventId, userId: user.id, role: input.role, invitedBy: actor.userId, updatedBy: actor.userId });
  }

  const roleLabel = ROLE_LABELS[input.role].toLowerCase();
  if (user.passwordHash) {
    await getMailer().send({
      to: user.email,
      subject: `You've been given access to ${event.name}`,
      text: `Hello ${user.name},\n\nYou can now sign in to ${event.name} as ${roleLabel}.\n\n${appUrl("/login")}\n`,
    });
  } else {
    const token = await issueToken("invite", user.id, INVITE_LINK_DAYS * 24 * 3600 * 1000, actor.userId);
    await getMailer().send({
      to: user.email,
      subject: `Invitation to ${event.name}`,
      text:
        `Hello ${user.name},\n\nYou've been invited to help with ${event.name} as ${roleLabel}.\n` +
        `Choose a password to set up your account:\n\n${appUrl(`/invite/${token}`)}\n\n` +
        `This link works once and expires in ${INVITE_LINK_DAYS} days.\n`,
    });
  }
  return { userId: user.id, restored: !!existing };
}

export async function acceptInvite(token: string, password: string): Promise<string> {
  const problem = passwordProblem(password);
  if (problem) throw invalid(problem);
  const userId = await consumeToken("invite", token);
  await db.update(users).set({ passwordHash: await hashPassword(password), updatedAt: new Date() }).where(eq(users.id, userId));
  return userId;
}

// ---------- Password reset ----------

/** Always succeeds silently, so the form never reveals which emails have accounts. */
export async function requestPasswordReset(email: string, requestedBy?: string): Promise<void> {
  const user = await findUserByEmail(email);
  if (!user || !user.passwordHash) return;
  const token = await issueToken("password_reset", user.id, RESET_LINK_MINUTES * 60 * 1000, requestedBy);
  await getMailer().send({
    to: user.email,
    subject: "Reset your password",
    text:
      `Hello ${user.name},\n\nUse this link to choose a new password:\n\n${appUrl(`/reset/${token}`)}\n\n` +
      `It works once and expires in one hour. If you didn't ask for this, you can ignore this email.\n`,
  });
}

/** An admin sends a reset link to a user. The admin never sees the password. */
export async function adminSendReset(actor: Actor, eventId: string, userId: string): Promise<void> {
  await authorize(actor, eventId, "manageUsers");
  const [m] = await db
    .select({ email: users.email })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.eventId, eventId), eq(memberships.userId, userId), isNull(memberships.removedAt)));
  if (!m) throw notFound("That user");
  await requestPasswordReset(m.email, actor.userId);
}

export async function resetPassword(token: string, password: string): Promise<string> {
  const problem = passwordProblem(password);
  if (problem) throw invalid(problem);
  const userId = await consumeToken("password_reset", token);
  await db.update(users).set({ passwordHash: await hashPassword(password), updatedAt: new Date() }).where(eq(users.id, userId));
  // Sign out everywhere else.
  await db.delete(sessions).where(eq(sessions.userId, userId));
  return userId;
}

// ---------- Roles ----------

async function otherActiveAdmins(eventId: string, userId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(memberships)
    .where(
      and(
        eq(memberships.eventId, eventId),
        eq(memberships.role, "admin"),
        isNull(memberships.removedAt),
        ne(memberships.userId, userId),
      ),
    );
  return row?.n ?? 0;
}

async function activeMembership(eventId: string, userId: string) {
  const [m] = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.eventId, eventId), eq(memberships.userId, userId), isNull(memberships.removedAt)));
  if (!m) throw notFound("That user");
  return m;
}

const LAST_ADMIN = "Every event needs at least one admin. Make someone else an admin first.";

export async function changeRole(actor: Actor, eventId: string, userId: string, role: Role): Promise<void> {
  await authorize(actor, eventId, "manageUsers");
  await db.transaction(async (tx) => {
    // Lock the event's admin rows so two admins can't demote each other at the same moment.
    await tx.execute(sql`select id from memberships where event_id = ${eventId} and role = 'admin' for update`);
    const m = await activeMembership(eventId, userId);
    if (m.role === "admin" && role !== "admin" && (await otherActiveAdmins(eventId, userId)) === 0) {
      throw forbidden(LAST_ADMIN);
    }
    await tx
      .update(memberships)
      .set({ role, updatedAt: new Date(), updatedBy: actor.userId })
      .where(eq(memberships.id, m.id));
  });
}

/** Ends the user's access to the event at once. Nothing they did is deleted. */
export async function removeUser(actor: Actor, eventId: string, userId: string): Promise<void> {
  await authorize(actor, eventId, "manageUsers");
  await db.transaction(async (tx) => {
    await tx.execute(sql`select id from memberships where event_id = ${eventId} and role = 'admin' for update`);
    const m = await activeMembership(eventId, userId);
    if (m.role === "admin" && (await otherActiveAdmins(eventId, userId)) === 0) throw forbidden(LAST_ADMIN);
    await tx
      .update(memberships)
      .set({ removedAt: new Date(), updatedAt: new Date(), updatedBy: actor.userId })
      .where(eq(memberships.id, m.id));
  });
}

export async function listMembers(actor: Actor, eventId: string) {
  await authorize(actor, eventId, "manageUsers");
  return db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      role: memberships.role,
      hasPassword: sql<boolean>`${users.passwordHash} is not null`,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.eventId, eventId), isNull(memberships.removedAt)))
    .orderBy(users.name);
}

/** Events the user can open, newest first, for the event switcher. */
export async function eventsForUser(userId: string) {
  return db
    .select({ id: events.id, name: events.name, date: events.date, status: events.status, role: memberships.role })
    .from(memberships)
    .innerJoin(events, eq(events.id, memberships.eventId))
    .where(and(eq(memberships.userId, userId), isNull(memberships.removedAt)))
    .orderBy(sql`${events.date} desc`);
}
