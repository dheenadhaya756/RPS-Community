import { notFound, redirect } from "next/navigation";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/admin";
import { loadAllWorkshops } from "@/lib/community/publicWorkshops";
import LoginsClient from "./LoginsClient";

export const metadata = {
  title: "Logins — RPS Cohorts",
  // Every account's name, email and mobile. Keep it out of every index that
  // will honour the ask.
  robots: { index: false, follow: false, nocache: true },
};

/* SERVER component, gated exactly like /admin/registrations: the session's
   verified email is checked here, a non-admin gets a 404 before anything is
   read, and the service-role client — needed because the auth user list and
   other people's profiles are closed to every normal session — never leaves
   the server. Only the fields rendered below are sent to the browser.

   This is the other list: everyone who has made an account on the site,
   whether or not they ever took a seat. /admin/registrations is only the
   people who filled in a workshop's form. */
export default async function LoginsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/signin?next=/admin/logins");
  if (!isAdminEmail(user.email)) notFound();

  const admin = createAdminClient();

  /* Every account, a thousand to a page — the most the API hands back at once.
     Capped at twenty pages so a misbehaving response can't loop forever. */
  const accounts = [];
  let failed = false;
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) {
      failed = true;
      break;
    }
    accounts.push(...(data?.users || []));
    if (!data?.users || data.users.length < 1000) break;
  }

  /* What the account filled in at signup and onboarding, and which workshops
     it holds a seat in. Either read failing leaves those columns blank rather
     than the page empty — the account list is the point. */
  const [{ data: profiles }, { data: seats }] = await Promise.all([
    admin.from("profiles").select("id, name, email, mobile, organisation"),
    admin
      .from("enrollments")
      .select("user_id, workshop_slug, status")
      .in("status", ["REGISTERED", "WAITLISTED", "ATTENDED"]),
  ]);

  const profileById = new Map((profiles || []).map((p) => [p.id, p]));
  const { workshops, error: workshopError } = await loadAllWorkshops();
  const cohortBySlug = Object.fromEntries(
    (workshops || []).map((w) => [w.slug, w.cohortLabel || w.title])
  );
  const seatsByUser = new Map();
  (seats || []).forEach((s) => {
    const list = seatsByUser.get(s.user_id) || [];
    list.push(cohortBySlug[s.workshop_slug] || s.workshop_slug);
    seatsByUser.set(s.user_id, list);
  });

  const PROVIDER = { email: "Email", google: "Google" };

  const rows = accounts
    .map((u) => {
      const p = profileById.get(u.id) || {};
      const meta = u.user_metadata || {};
      const providers = u.app_metadata?.providers || [u.app_metadata?.provider].filter(Boolean);
      return {
        id: u.id,
        name: p.name || meta.full_name || meta.name || "",
        email: u.email || p.email || "",
        mobile: p.mobile || "",
        organisation: p.organisation || "",
        via: providers.map((x) => PROVIDER[x] || x).join(" + "),
        createdAt: u.created_at,
        lastSignInAt: u.last_sign_in_at || null,
        workshops: [...new Set(seatsByUser.get(u.id) || [])].sort(),
      };
    })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  return <LoginsClient rows={rows} failed={failed} workshopsError={workshopError} viewer={user.email} />;
}
