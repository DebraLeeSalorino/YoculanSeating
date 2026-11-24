import { getEvent } from "@/domain/events";
import { can, roleIn } from "@/domain/permissions";
import { NoPermission } from "../../no-permission";
import { requireUser } from "@/lib/session";
import { EventbriteForm } from "./form";

export default async function EventbritePage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const user = await requireUser();
  if (!can(await roleIn(user.id, eventId), "enterEventbriteOrders")) return <NoPermission />;
  const { event } = await getEvent({ userId: user.id }, eventId);
  return (
    <div className="card" style={{ maxWidth: 760 }}>
      <h1>Enter an Eventbrite order</h1>
      <p className="muted">
        The tickets are saved as Paid and credited to Eventbrite. Names left blank become “Guest of” the buyer and can
        be filled in later.
      </p>
      <EventbriteForm
        eventId={eventId}
        seatedPrice={event.seatedPriceCents}
        standingPrice={event.standingPriceCents}
        currency={event.currency}
      />
    </div>
  );
}
