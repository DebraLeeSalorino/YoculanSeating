import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Yoculan Seating",
  description: "Tickets and seating for the event",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
