import Link from "next/link";
import { notFound } from "next/navigation";
import { can, roleIn, ROLE_LABELS } from "@/domain/permissions";
import { eventsForUser } from "@/domain/users";
import { requireUser } from "@/lib/session";
import { signOutAction } from "../../(auth)/actions";
import { EventSwitcher } from "./event-switcher";

export default async function EventLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  const user = await requireUser();
  const role = await roleIn(user.id, eventId).catch(() => null);
  if (!role) notFound();
  const events = await eventsForUser(user.id);

  return (
    <>
      <header className="topbar">
        <span className="brand">Yoculan Seating</span>
        <EventSwitcher
          current={eventId}
          events={events.map((e) => ({ id: e.id, label: `${e.name} (${new Date(e.date).getFullYear()})` }))}
        />
        <nav aria-label="Main">
          {can(role, "editCustomers") && <Link href={`/e/${eventId}/customers`}>Customers</Link>}
          {can(role, "manageUsers") && <Link href={`/e/${eventId}/settings/users`}>Users</Link>}
        </nav>
        <span className="spacer" />
        <span className="who">
          {user.name} · {ROLE_LABELS[role]}
        </span>
        <form action={signOutAction} className="inline-form">
          <button type="submit" className="secondary">Sign out</button>
        </form>
      </header>
      <main>{children}</main>
    </>
  );
}
