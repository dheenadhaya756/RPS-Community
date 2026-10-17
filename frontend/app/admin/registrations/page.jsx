import { notFound, redirect } from "next/navigation";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { isAdminUser } from "@/lib/admin";
import { loadAllWorkshops } from "@/lib/community/publicWorkshops";
import { isPast, dateFull } from "@/lib/community/workshops";
import { promoteWaitlisted } from "@/lib/seats";
import RegistrationsClient from "./RegistrationsClient";

/* Everything before this is test data from building the thing, so the list
   starts here. Filtered in the query rather than deleted from the database:
   the old rows are somebody's record of what was tried, and a date is
   reversible in a way a DELETE is not.

   An ISO instant with the offset on it, because "15 September" in IST starts
   five and a half hours before it does in UTC, and a registration taken on the
   evening of the 14th UTC belongs to the 15th here. */
const REGISTRATIONS_FROM =
  process.env.REGISTRATIONS_FROM || "2026-09-15T00:00:00+05:30";

// Sending a message to a whole list runs at the mail provider's pace, which
// for a full cohort is longer than the default function time limit.
export const maxDuration = 60;

export const metadata = {
  title: "Registrations — RPS Cohorts",
  // This page lists real people's contact details. Keep it out of every index
  // that will honour the ask.
  robots: { index: false, follow: false, nocache: true },
};

/* SERVER component. Every decision that matters happens here:

   - The gate is the session's verified email, read server-side. Nothing about
     who is an admin reaches the browser, and there is no client-side check to
     bypass — a non-admin gets a 404 before any data is fetched.
   - 404 rather than "not allowed", so the page's existence is not advertised to
     an account that cannot open it.
   - The read uses the service-role client, because RLS on `enrollments` limits
     every normal session to its own row. That key never leaves the server, and
     only the rows rendered below are serialised to the client. */
export default async function RegistrationsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/signin?next=/admin/registrations");
  if (!isAdminUser(user)) notFound();

  /* This is the workshop registration list and nothing else.

     Every row is somebody who filled in the form on a workshop page. Creating
     an account does not put anyone here — `enrollments` is only written when a
     seat is taken — and the account an address signed in with is deliberately
     not read, because it is not what this list is about. */
  const admin = createAdminClient();

  // There is no waitlist: anyone still on one for an upcoming workshop is moved
  // onto the list (and emailed that they're in) before the list is read, so
  // this page never shows somebody waiting.
  await promoteWaitlisted(admin);

  /* Two reads: the live list, and the trash. `removed_by` and `removed_at` only
     exist once supabase/admin-moderation.sql has been run, so the select asks
     for them and falls back to the columns that have always been there. The
     page works either way — the trash just cannot say who did it. */
  const LIVE = ["REGISTERED", "WAITLISTED", "ATTENDED"];
  const GONE = ["CANCELLED", "REJECTED"];

  async function read(withAudit) {
    const cols = withAudit
      ? "id, workshop_slug, name, email, whatsapp, status, created_at, removed_by, removed_at"
      : "id, workshop_slug, name, email, whatsapp, status, created_at";
    const live = await admin
      .from("enrollments")
      .select(cols)
      .in("status", LIVE)
      .gte("created_at", REGISTRATIONS_FROM)
      .order("created_at", { ascending: false });
    const gone = await admin
      .from("enrollments")
      .select(cols)
      .in("status", GONE)
      .gte("created_at", REGISTRATIONS_FROM)
      .order("updated_at", { ascending: false });
    return { live, gone };
  }

  let { live, gone } = await read(true);
  let hasAudit = true;
  if (live.error || gone.error) {
    ({ live, gone } = await read(false));
    hasAudit = false;
  }

  const data = live.data;
  const error = live.error;

  /* Names, dates, and Meet links come from the workshops table. A registration
     row only stores the slug, and this read does not change that row. */
  const { workshops: stored, error: workshopError } = await loadAllWorkshops();
  const workshops = (stored || [])
    .slice()
    .sort((a, b) => new Date(b.dateTime) - new Date(a.dateTime))
    .map((w) => ({
      slug: w.slug,
      title: w.title,
      cohort: w.cohortLabel || "",
      cohortLabel: w.cohortLabel || "",
      date: w.dateTime ? dateFull(w.dateTime) : "",
      past: w.dateTime ? isPast(w) : false,
      dateTime: w.dateTime,
      durationMins: w.durationMins,
      meetLink: w.meetLink,
    }));
  const titles = Object.fromEntries(workshops.map((w) => [w.slug, w.title]));

  // The upcoming session, not merely the newest row — once 19 Sep has been and
  // gone this should follow on to whatever is next rather than staying put.
  const nextUp = workshops.filter((w) => !w.past).pop() || workshops[0];

  const shape = (r) => ({
    id: r.id,
    slug: r.workshop_slug,
    workshop: titles[r.workshop_slug] || r.workshop_slug,
    name: r.name || "",
    email: r.email || "",
    whatsapp: r.whatsapp || "",
    status: r.status || "",
    createdAt: r.created_at,
    removedBy: r.removed_by || null,
    removedAt: r.removed_at || null,
  });

  const rows = (data || []).map(shape);
  const trash = (gone.data || []).map(shape);

  return (
    <RegistrationsClient
      rows={rows}
      failed={!!error}
      workshopsError={workshopError}
      viewer={user.email}
      workshops={workshops}
      initialSlug={nextUp?.slug || "all"}
      since={dateFull(REGISTRATIONS_FROM)}
      trash={trash}
      hasAudit={hasAudit}
    />
  );
}
