import { redirect } from "next/navigation";
import { eventsForUser } from "@/domain/users";
import { requireUser } from "@/lib/session";

export default async function Home() {
  const user = await requireUser();
  const events = await eventsForUser(user.id);
  const live = events.find((e) => e.status === "live") ?? events[0];
  if (!live) {
    return (
      <main className="narrow">
        <div className="card">
          <h1>No events yet</h1>
          <p>You don't have access to any event. Ask an admin to invite you.</p>
        </div>
      </main>
    );
  }
  redirect(`/e/${live.id}`);
}
