import type { Metadata } from "next";
import { loadBuyerPage } from "@/domain/buyer-page";
import { GuestsForm } from "./guests-form";

export const metadata: Metadata = {
  title: "Your tickets",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function BuyerPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const page = await loadBuyerPage(code);
  if (!page) {
    return (
      <main className="narrow">
        <div className="card">
          <h1>Page not found</h1>
          <p>Check that you used the full link from your email.</p>
        </div>
      </main>
    );
  }
  const dateText = new Intl.DateTimeFormat("en", { dateStyle: "full", timeStyle: "short", timeZone: page.timeZone }).format(page.eventDate);
  const hasGuests = page.tickets.some((t) => !t.isBuyer && !t.refunded);

  return (
    <main style={{ maxWidth: 640 }}>
      <h1>
        {page.eventName} {page.eventYear}
      </h1>
      <p className="muted">{dateText}</p>
      <p>
        Hello {page.buyerName}. Here {page.tickets.length === 1 ? "is your ticket" : `are your ${page.tickets.length} tickets`}.
      </p>

      <ul>
        {page.tickets.map((t) => (
          <li key={t.id}>
            Ticket {t.position}: {t.name || page.placeholder}
            {t.isBuyer && " (you)"}
            {t.ticketType === "standing" && " · standing room"}
            {t.refunded && " · refunded"}
          </li>
        ))}
      </ul>

      {hasGuests &&
        (page.editable ? (
          <>
            <h2>Tell us who's coming</h2>
            <p>
              Add each guest's name, and if you like their email or phone. A guest with their own email will receive
              their own ticket; otherwise it comes to you. You can come back and change this until{" "}
              {new Intl.DateTimeFormat("en", { dateStyle: "long", timeStyle: "short", timeZone: page.timeZone }).format(page.closesAt)}.
            </p>
            <GuestsForm code={code} tickets={page.tickets} placeholder={page.placeholder} />
          </>
        ) : (
          <p className="notice warn">Guest details can no longer be changed online. Please contact the organisers.</p>
        ))}

      <h2>Good to know</h2>
      <ul className="muted">
        <li>Tickets are non-refundable.</li>
        <li>You can't change the number of tickets or seats here. Seat details will appear on this page once seats are sent.</li>
        <li>
          We keep the names and contact details you give us so we can manage the event and recognise returning guests
          in future years. They are not shared or shown publicly.
        </li>
      </ul>
    </main>
  );
}
