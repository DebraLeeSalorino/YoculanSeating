"use client";

import { useRouter } from "next/navigation";

/** Shows which event the user is in and lets them switch (section 15). */
export function EventSwitcher({ current, events }: { current: string; events: { id: string; label: string }[] }) {
  const router = useRouter();
  if (events.length <= 1) return <strong>{events[0]?.label}</strong>;
  return (
    <select
      aria-label="Event"
      value={current}
      onChange={(e) => router.push(`/e/${e.target.value}`)}
      style={{ width: "auto", fontWeight: 600 }}
    >
      {events.map((e) => (
        <option key={e.id} value={e.id}>
          {e.label}
        </option>
      ))}
    </select>
  );
}
