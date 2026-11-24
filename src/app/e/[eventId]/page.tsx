import { redirect } from "next/navigation";
import { can, roleIn } from "@/domain/permissions";
import { requireUser } from "@/lib/session";

export default async function EventHome({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const user = await requireUser();
  const role = await roleIn(user.id, eventId);
  if (can(role, "editCustomers")) redirect(`/e/${eventId}/customers`);
  return (
    <div className="card">
      <h1>Welcome</h1>
      <p>The check-in screen for door staff arrives in a later release.</p>
    </div>
  );
}
