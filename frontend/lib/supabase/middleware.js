import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";

// Routes that require an authenticated user.
// Matched on a path boundary, not a bare prefix: "/workshop" is the members'
// page and stays gated, while the public listing at "/workshops" and the
// public detail pages under "/workshops/<slug>" must stay browsable — the
// gate there fires on the action (enrol, watch, download), not the page.
const PROTECTED = ["/dashboard", "/workshop", "/admin"];
// Auth routes an already-signed-in user shouldn't see.
const AUTH_ROUTES = ["/signin"];

// Set the first time someone proves they have an account. It decides which of
// the two public doors a signed-out visitor is shown, and nothing else — so a
// missing or forged value costs nothing beyond the wrong greeting.
const RETURNING_COOKIE = "rps.returning";

// Onboarding is not a step you can walk around on the way to a members' page:
// a signed-in account with no answers on file is sent to the form from any page
// that isn't listed below, not just the gated ones.
//
// These are the only paths that stay reachable while it's outstanding: the form
// itself, the endpoints that finish or repair a session, the legal pages (which
// must be readable by anyone, including someone mid-signup), and the workshop
// pages.
//
// Workshops are exempt because taking a seat asks for the three things it
// actually needs — name, email, WhatsApp — on the page itself. Making someone
// answer the role/goals/tools wizard before they can register was a wall in
// front of the one action the site is for. Onboarding still guards /dashboard
// and /workshop, which are the pages that genuinely read a profile.
const ONBOARDING_EXEMPT = [
  "/onboarding",
  "/auth",
  "/reset-password",
  "/forgot-password",
  "/privacy",
  "/terms",
  "/workshops",
  // The registration list is for the team, not for members. Sending an admin
  // through the role/goals/tools wizard to reach it would be asking the wrong
  // question of the wrong person — the gate there is the email, not a profile.
  "/admin",
];

const matches = (pathname, base) => pathname === base || pathname.startsWith(base + "/");

// Pages worth coming back to once onboarding is done: a gated page, or a
// workshop the person was in the middle of taking a seat for. Anything else —
// the homepage above all — is a starting point, not a destination.
function isReturnable(target) {
  const path = String(target || "").split(/[?#]/)[0];
  if (!path || path === "/") return false;
  if (PROTECTED.some((p) => matches(path, p))) return true;
  // The portfolio review's link box is waiting on that page.
  if (matches(path, "/review")) return true;
  return matches(path, "/workshops") && path !== "/workshops";
}

// Has this user finished onboarding?
//
// This is the ONE place it gets decided. It used to be checked in the OAuth
// callback and in the dashboard page only, which left every other way of
// arriving signed-in — password, WhatsApp/SMS OTP, or a Google redirect that
// skipped /auth/callback — able to walk straight past the form.
//
// Onboarding writes `role` to user_metadata as well as the profiles row, so the
// common case is answered from the session with no query. Only when that's
// missing do we pay for a lookup, and then against `profiles`, which is the
// source of truth (user_metadata is user-writable, so it can't be trusted on
// its own to say someone IS onboarded — but it's fine as a fast path because a
// forged one only sends them somewhere they could reach anyway).
//
// Finished means the signup form was sent: `terms_accepted_at` is stamped by
// it (and `onboarded` set in user_metadata alongside). Signup used to have a
// second step whose `role` answer was the marker; it's gone, so a role on file
// still counts — every account made before now has one — but is no longer
// asked for.
async function hasCompletedOnboarding(supabase, user) {
  const meta = user.user_metadata || {};
  if (meta.onboarded || meta.role) return true;
  const { data } = await supabase
    .from("profiles")
    .select("role, terms_accepted_at")
    .eq("id", user.id)
    .single();
  return !!(data?.role || data?.terms_accepted_at);
}

export async function updateSession(request) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // IMPORTANT: refreshes the auth token; do not run other logic between
  // createServerClient and getUser.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  // Local testing only (`npm run dev` with REVIEW_DEV_NO_AUTH=1, never a
  // build): the 1:1 bookings list opens without logging in, like /review.
  const devOpen =
    process.env.NODE_ENV !== "production" &&
    process.env.REVIEW_DEV_NO_AUTH === "1" &&
    matches(pathname, "/admin/bookings");
  const isProtected = !devOpen && PROTECTED.some((p) => matches(pathname, p));
  const isAuthRoute = AUTH_ROUTES.some((p) => matches(pathname, p));

  if (!user && isProtected) {
    // Signup is the default door. A first-time visitor has no account, so
    // opening with a login form asks them to do the one thing they cannot —
    // whereas someone who has signed in on this browser before gets the login
    // box, because for them the signup form is the dead end.
    const returning = request.cookies.get(RETURNING_COOKIE)?.value === "1";
    const url = request.nextUrl.clone();
    url.pathname = returning ? "/signin" : "/onboarding";
    url.search = "";
    url.searchParams.set("next", pathname + (request.nextUrl.search || ""));
    return NextResponse.redirect(url);
  }

  // Signed in, but the profile was never filled in: finish that first, then
  // carry on to wherever they were going. Checked before the auth-route
  // redirect below so someone landing on /signin with a live session goes to
  // the form rather than bouncing via the dashboard.
  if (user && !ONBOARDING_EXEMPT.some((p) => matches(pathname, p))) {
    if (!(await hasCompletedOnboarding(supabase, user))) {
      const url = request.nextUrl.clone();
      // Where to put them once they're done. An auth route is not a
      // destination, so honour its ?next (or fall back to the dashboard)
      // instead of sending them back to the login box they just left.
      let back = pathname + (request.nextUrl.search || "");
      if (isAuthRoute) {
        const wanted = request.nextUrl.searchParams.get("next");
        back = wanted && wanted.startsWith("/") && !wanted.startsWith("//")
          ? wanted
          : "/dashboard";
      }
      // The marketing pages are where people happen to BE, not somewhere they
      // asked to go. Sending them back to the homepage after the form makes the
      // last step's "Go to my workshops" land on the landing page. Only a page
      // with something waiting on it is worth returning to.
      if (!isReturnable(back)) back = "/dashboard";
      url.pathname = "/onboarding";
      url.search = "";
      url.searchParams.set("mode", "complete");
      url.searchParams.set("next", back);
      return NextResponse.redirect(url);
    }
  }

  if (user && isAuthRoute) {
    // Honour the ?next the gated action carried in, so someone who was already
    // signed in lands back on the workshop they were enrolling for rather than
    // being dropped on the dashboard. Relative paths only — an absolute URL
    // here would be an open redirect.
    const next = request.nextUrl.searchParams.get("next");
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    if (next && next.startsWith("/") && !next.startsWith("//")) {
      const target = new URL(next, request.url);
      url.pathname = target.pathname;
      url.search = target.search;
      url.hash = target.hash;
    }
    return NextResponse.redirect(url);
  }

  return response;
}
