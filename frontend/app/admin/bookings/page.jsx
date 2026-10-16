import { notFound, redirect } from "next/navigation";
import { listBookings } from "@/lib/review/bookings-store";
import { bookingsAccess } from "@/lib/review/bookings-gate";
import BookingsClient from "./BookingsClient";

export const metadata = {
  title: "1:1 bookings — RPS Cohorts",
  // Names, emails and WhatsApp numbers. Keep it out of every index.
  robots: { index: false, follow: false, nocache: true },
};

/* SERVER component, gated like the other admin lists: a signed-in admin, or
   the pretend tester in local testing. Bookings are read from the review
   engine (portfolio-auditor/rps_api.py), which stores them. */
export default async function BookingsPage() {
  const { user, allowed } = await bookingsAccess();
  if (!user) redirect("/signin?next=/admin/bookings");
  if (!allowed) notFound();

  const res = await listBookings();
  return <BookingsClient rows={res.bookings || []} failed={res.error || ""} />;
}
