import Link from "next/link";
import { getCapacity } from "@/domain/capacity";
import { getEvent } from "@/domain/events";
import { can } from "@/domain/permissions";
import { requireUser } from "@/lib/session";
import { NoPermission } from "../no-permission";
import { squareSettings } from "@/domain/square";
import { SettingsFormView } from "./form";
import { SquareSettings } from "./square-settings";

const dollars = (cents: number) => (cents / 100).toFixed(2);

export default async function SettingsPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const user = await requireUser();
  const { event, role } = await getEvent({ userId: user.id }, eventId);
  if (!can(role, "manageEvent")) return <NoPermission />;
  const [capacity, square] = await Promise.all([getCapacity(eventId), squareSettings({ userId: user.id }, eventId)]);

  return (
    <>
      <div className="row" style={{ alignItems: "center", marginBottom: "1rem" }}>
        <h1 style={{ margin: 0 }}>Settings</h1>
        <div className="shrink">
          <Link className="button secondary" href={`/e/${eventId}/settings/users`}>
            Users and roles
          </Link>
        </div>
      </div>
      <SettingsFormView
        eventId={eventId}
        initial={{
          name: event.name,
          date: event.date.toISOString(),
          timeZone: event.timeZone,
          defaultCountry: event.defaultCountry,
          currency: event.currency,
          seatedPrice: dollars(event.seatedPriceCents),
          standingPrice: dollars(event.standingPriceCents),
          generalSeats: capacity.fromFloorPlan ? String(capacity.generalSeats) : String(event.generalSeatsOverride ?? ""),
          standingTickets: String(event.standingTickets),
          venueCapacity: String(event.venueCapacity),
          warningPercent: String(event.sellOutWarningPercent),
          buyerPageClosesAt: event.buyerPageClosesAt?.toISOString() ?? null,
          seatsFromFloorPlan: capacity.fromFloorPlan,
          reservedSeats: capacity.reservedSeats,
        }}
      />
      <SquareSettings
        eventId={eventId}
        connected={square.connected}
        environment={square.connected ? square.environment : undefined}
        locationId={square.connected ? square.locationId : null}
        locations={square.connected ? square.locations : []}
        terminals={square.connected ? square.terminals : []}
        error={square.connected ? square.error : null}
      />
    </>
  );
}
