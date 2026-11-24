import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { authTokens, customers } from "@/db/schema";
import {
  acceptInvite,
  adminSendReset,
  changeRole,
  eventsForUser,
  inviteUser,
  removeUser,
  requestPasswordReset,
  resetPassword,
  signIn,
  userForSession,
} from "@/domain/users";
import { createSale } from "@/domain/customers";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { as, linkPath, mailer, makeEvent, PASSWORD } from "./helpers";

describe("passwords", () => {
  it("hashes and verifies", async () => {
    const hash = await hashPassword("a long enough password");
    expect(hash).not.toContain("a long enough password");
    expect(await verifyPassword("a long enough password", hash)).toBe(true);
    expect(await verifyPassword("wrong password!!", hash)).toBe(false);
    expect(await verifyPassword("anything", null)).toBe(false);
  });
});

describe("invitations", () => {
  it("an admin invites a new user, who sets a password once and can then sign in", async () => {
    const { event, admin } = await makeEvent();
    await inviteUser(as(admin), event.id, { name: "Nina New", email: "Nina@Example.org", role: "ticket_seller" });

    const mail = mailer().last("nina@example.org")!;
    expect(mail.subject).toContain("Invitation");
    const token = linkPath(mail.text).split("/").pop()!;

    await expect(acceptInvite(token, "short")).rejects.toThrow(/at least/);
    const userId = await acceptInvite(token, "a brand new password");
    await expect(acceptInvite(token, "a brand new password")).rejects.toThrow(/expired or has already been used/);

    const session = await signIn("nina@example.org", "a brand new password");
    expect(session?.userId).toBe(userId);
    expect((await userForSession(session!.token))?.name).toBe("Nina New");
    const evs = await eventsForUser(userId);
    expect(evs.map((e) => [e.id, e.role])).toEqual([[event.id, "ticket_seller"]]);
  });

  it("only admins can invite", async () => {
    const { event, seller } = await makeEvent();
    await expect(
      inviteUser(as(seller), event.id, { name: "X", email: "x@example.org", role: "admin" }),
    ).rejects.toThrow(/permission/);
  });

  it("wrong passwords and unknown emails are refused the same way", async () => {
    const { seller } = await makeEvent();
    expect(await signIn(seller.email, "not the password")).toBeNull();
    expect(await signIn("nobody@example.org", PASSWORD)).toBeNull();
    expect(await signIn(seller.email.toUpperCase(), PASSWORD)).not.toBeNull();
  });
});

describe("password reset", () => {
  it("emails a single-use link that sets a new password", async () => {
    const { seller } = await makeEvent();
    const old = await signIn(seller.email, PASSWORD);
    await requestPasswordReset(seller.email);
    const token = linkPath(mailer().last(seller.email)!.text).split("/").pop()!;

    await resetPassword(token, "my new secure password");
    await expect(resetPassword(token, "another new password")).rejects.toThrow(/already been used/);

    expect(await signIn(seller.email, PASSWORD)).toBeNull();
    expect(await signIn(seller.email, "my new secure password")).not.toBeNull();
    // Existing sessions are signed out.
    expect(await userForSession(old!.token)).toBeNull();
  });

  it("links expire after one hour", async () => {
    const { seller } = await makeEvent();
    await requestPasswordReset(seller.email);
    const token = linkPath(mailer().last(seller.email)!.text).split("/").pop()!;
    await db.update(authTokens).set({ expiresAt: new Date(Date.now() - 1000) });
    await expect(resetPassword(token, "my new secure password")).rejects.toThrow(/expired/);
  });

  it("does not reveal whether an email has an account", async () => {
    await expect(requestPasswordReset("nobody@example.org")).resolves.toBeUndefined();
    expect(mailer().sent).toHaveLength(0);
  });

  it("an admin can send a user a reset link without seeing the password", async () => {
    const { event, admin, door } = await makeEvent();
    await adminSendReset(as(admin), event.id, door.id);
    expect(mailer().last(door.email)?.subject).toBe("Reset your password");
  });
});

describe("roles", () => {
  it("the last admin of an event cannot be removed or given another role", async () => {
    const { event, admin, seller } = await makeEvent();
    await expect(changeRole(as(admin), event.id, admin.id, "ticket_seller")).rejects.toThrow(/at least one admin/);
    await expect(removeUser(as(admin), event.id, admin.id)).rejects.toThrow(/at least one admin/);

    await changeRole(as(admin), event.id, seller.id, "admin");
    await changeRole(as(seller), event.id, admin.id, "door_staff");
    await expect(changeRole(as(seller), event.id, seller.id, "door_staff")).rejects.toThrow(/at least one admin/);
  });

  it("removing a user ends their access and keeps what they did; re-inviting restores them", async () => {
    const { event, admin, seller } = await makeEvent();
    await createSale(as(seller), event.id, { ticketType: "seated", payment: "unpaid", people: [{ name: "Ann Buyer" }] });

    await removeUser(as(admin), event.id, seller.id);
    expect(await signIn(seller.email, PASSWORD)).toBeNull();
    await expect(
      createSale(as(seller), event.id, { ticketType: "seated", payment: "unpaid", people: [{ name: "B" }] }),
    ).rejects.toThrow(/access/);
    const rows = await db.select().from(customers).where(eq(customers.soldBy, seller.id));
    expect(rows).toHaveLength(1);

    const res = await inviteUser(as(admin), event.id, { name: seller.name, email: seller.email, role: "ticket_seller" });
    expect(res.restored).toBe(true);
    expect(await signIn(seller.email, PASSWORD)).not.toBeNull();
  });
});
