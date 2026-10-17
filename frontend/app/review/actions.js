"use server";

import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/server";
import { DEV_COOKIE, DEV_NO_AUTH, reviewAccess, signedInUser } from "@/lib/review/viewer";
import { launchLabel } from "@/lib/review/launch";
import { bookingSchema, portfolioReviewSchema } from "@/lib/validation";
import { latestForUser, readAudit, reviewsSince, startAudit } from "@/lib/review/auditor";
import { createBooking as saveBooking, listBookings } from "@/lib/review/bookings-store";
import { loadSavedReport, saveReport } from "@/lib/review/report-store";
import { MENTORING_PRICE_INR, REVIEWS_PER_DAY, SLOTS } from "@/lib/review/content";

// Server Actions for /review. The browser sends the link and nothing else; who
// it belongs to comes from the verified session.
//
// REVIEWS_PER_DAY free reviews per account per day, resetting at midnight IST.
// The count is checked here, on the server, against two records:
//   - the review engine's own list of reviews per account, and
//   - the account itself (`app_metadata.portfolio_reviews`), which only the
//     service role can write — so it survives the engine's database being
//     reset, and nobody can clear it from their own browser.
// A review that failed (the site wouldn't open, the model was busy) doesn't
// count, so they can try again.
//
// Before launch (lib/review/launch.js) only admins can start one.

// The table not existing yet is an expected state — the SQL file hasn't been
// run — not a crash. PostgREST says so with one of these.
const MISSING_TABLE = new Set(["42P01", "PGRST205"]);

// People type "yourname.com", not "https://yourname.com". Add the scheme
// rather than reject a perfectly good link for the lack of it.
function withScheme(raw) {
  const v = String(raw || "").trim();
  if (!v || /^[a-z][a-z0-9+.-]*:/i.test(v)) return v;
  return "https://" + v.replace(/^\/+/, "");
}

function adminClient() {
  try {
    return createAdminClient();
  } catch {
    return null;
  }
}

const NOT_YET = `Portfolio review opens on ${launchLabel()}. See you there!`;

/* The start of today in India, as epoch seconds: the daily count resets here. */
function istDayStart(now = Date.now()) {
  const IST = 5.5 * 3600 * 1000;
  const local = now + IST;
  return Math.floor((local - (local % 86400000) - IST) / 1000);
}

/* Today's reviews for this account, plus the latest one ever (for "See your
   report"). `{ error }` when the engine can't be reached — the caller treats
   that as "can't start one now" rather than letting extra reviews through. */
async function reviewStatus(user) {
  const since = istDayStart();
  const engine = await reviewsSince(user.id, since);
  if (engine.error) return { error: engine.error };

  const today = new Map((engine.reviews || []).map((r) => [r.id, r]));
  // What the account remembers — counted too, unless the engine knows it failed.
  const stamped = Array.isArray(user.app_metadata?.portfolio_reviews) ? user.app_metadata.portfolio_reviews : [];
  for (const r of stamped) {
    if (!r?.id || today.has(r.id)) continue;
    if (new Date(r.at).getTime() / 1000 < since) continue;
    const job = await readAudit(r.id, user.id);
    if (job?.status === "failed") continue;
    today.set(r.id, { id: r.id, url: r.url, status: job?.status || "done", created: new Date(r.at).getTime() / 1000 });
  }

  let latest = [...today.values()].sort((a, b) => b.created - a.created)[0] || null;
  if (!latest) {
    const ever = await latestForUser(user.id);
    latest = ever.review || (stamped[0]?.id ? { id: stamped[0].id, url: stamped[0].url } : null);
  }
  const used = today.size;
  return { used, left: Math.max(0, REVIEWS_PER_DAY - used), limit: REVIEWS_PER_DAY, latest };
}

/* Write it on the account, so the limit holds even if the engine forgets. */
async function stampAccount(user, id, url) {
  if (user.isDev) return; // the pretend local account has no Supabase record to write on
  const admin = adminClient();
  if (!admin) {
    console.warn("[review] No service-role key: the daily limit is held by the engine only.");
    return;
  }
  const at = new Date().toISOString();
  const list = Array.isArray(user.app_metadata?.portfolio_reviews) ? user.app_metadata.portfolio_reviews : [];
  const { error } = await admin.auth.admin.updateUserById(user.id, {
    app_metadata: {
      ...(user.app_metadata || {}),
      portfolio_review: { id, url, at },
      portfolio_reviews: [{ id, url, at }, ...list].slice(0, 20),
    },
  });
  if (error) console.error("[review] Could not record the review on the account:", error.message);
}

/* Local testing only: start over as a fresh pretend account. */
export async function resetDevTester() {
  if (!DEV_NO_AUTH) return { ok: false };
  const jar = await cookies();
  jar.set(DEV_COOKIE, "t" + Date.now().toString(36), { path: "/", httpOnly: true, sameSite: "lax" });
  return { ok: true };
}

/* What /review shows a signed-in person: how many free reviews are left
   today, and their latest report. */
export async function getMyReview() {
  const { user } = await signedInUser();
  if (!user) return { signedIn: false };
  const res = await reviewStatus(user);
  if (res.error) return { signedIn: true, error: res.error };
  return { signedIn: true, ...res };
}

export async function submitPortfolio(input) {
  const parsed = portfolioReviewSchema.safeParse({
    portfolioUrl: withScheme(input?.portfolioUrl),
    caseStudyUrl: withScheme(input?.caseStudyUrl),
  });
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path?.[0];
    return {
      ok: false,
      field,
      error:
        (field === "caseStudyUrl" ? "The case study link: " : "") +
        (parsed.error.issues[0]?.message || "That link doesn’t look right."),
    };
  }

  const { supabase, user, open } = await reviewAccess();
  if (!user) return { ok: false, needsAuth: true, error: "Log in to get your review." };
  if (!open) return { ok: false, error: NOT_YET };

  const status = await reviewStatus(user);
  if (status.error) return { ok: false, error: status.error };
  if (status.left <= 0) {
    return {
      ok: false,
      used: true,
      latest: status.latest,
      error: `You’ve used today’s ${REVIEWS_PER_DAY} free reviews. Come back tomorrow, or book a 1:1 call with us.`,
    };
  }

  const meta = user.user_metadata || {};
  const { portfolioUrl, caseStudyUrl = "" } = parsed.data;

  const { error } = user.isDev ? { error: null } : await supabase.from("portfolio_reviews").upsert(
    {
      user_id: user.id,
      email: user.email,
      name: meta.name || meta.full_name || null,
      portfolio_url: portfolioUrl,
    },
    { onConflict: "user_id,portfolio_url" }
  );

  if (error) {
    // The row is the team's record of who asked; the review itself doesn't need
    // it, so a missing table is logged rather than turned into a dead end.
    if (MISSING_TABLE.has(error.code)) {
      console.error("[review] portfolio_reviews is missing — run supabase/portfolio-reviews.sql.");
    } else {
      console.error("[review] Could not save portfolio link:", error.message);
    }
  }

  const started = await startAudit(portfolioUrl, user.id, caseStudyUrl, {
    dailyLimit: REVIEWS_PER_DAY,
    since: istDayStart(),
  });
  if (started.limit) {
    return {
      ok: false,
      used: true,
      latest: status.latest,
      error: `You’ve used today’s ${REVIEWS_PER_DAY} free reviews. Come back tomorrow, or book a 1:1 call with us.`,
    };
  }
  if (started.error) return { ok: false, error: started.error };
  await stampAccount(user, started.id, portfolioUrl);
  return { ok: true, id: started.id, portfolioUrl };
}

// A review's progress, polled by /review/report/[id]. The engine checks the id
// belongs to this user, so someone else's link reads as "not found".
export async function getReview(id) {
  if (!/^[a-f0-9]{32}$/.test(String(id || ""))) return { notFound: true };

  const { user } = await signedInUser();
  if (!user) return { needsAuth: true };

  // Saved in Supabase already? That copy outlives the engine.
  const saved = await loadSavedReport(id, user.id);
  if (saved) return saved;

  const job = await readAudit(id, user.id);
  if (job?.status === "done") await saveReport(id, user.id, job);
  return job;
}

/* --------------------------------------------------------- 1:1 booking
   /review/book. Booking needs an account, like the review: who it belongs to
   comes from the session, and the team reaches them on the WhatsApp number
   given here to confirm a time and send the payment link. */

/* What the form can fill in already: name and email from the account, the
   portfolio from their review, and any request they've already sent. */
export async function getBookingPrefill() {
  const { user } = await signedInUser();
  if (!user) return { signedIn: false };
  const meta = user.user_metadata || {};
  const mine = await reviewStatus(user);
  const booked = await listBookings(user.id);
  const open = (booked.bookings || []).find((b) => b.status !== "DONE" && b.status !== "CANCELLED") || null;
  return {
    signedIn: true,
    name: meta.name || meta.full_name || "",
    email: user.isDev ? "" : user.email || "",
    portfolioUrl: mine.latest?.url || "",
    reportId: mine.latest?.id || "",
    open: open ? { id: open.id, slot: open.slot, status: open.status, created: open.created } : null,
  };
}

export async function createBooking(input) {
  const parsed = bookingSchema.safeParse({
    name: input?.name,
    email: input?.email,
    whatsapp: input?.whatsapp,
    portfolioUrl: withScheme(input?.portfolioUrl),
    reportId: input?.reportId || "",
    slot: input?.slot,
    topic: input?.topic || "",
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, field: issue?.path?.[0], error: issue?.message || "Check the form and try again." };
  }
  if (!SLOTS.includes(parsed.data.slot)) {
    return { ok: false, field: "slot", error: "Pick a time that suits you." };
  }

  const { user, open } = await reviewAccess();
  if (!user) return { ok: false, needsAuth: true, error: "Log in to book a call." };
  if (!open) return { ok: false, error: NOT_YET };

  const d = parsed.data;
  const res = await saveBooking({
    user_id: user.id,
    name: d.name,
    email: d.email,
    whatsapp: d.whatsapp,
    portfolio_url: d.portfolioUrl || "",
    report_id: d.reportId || "",
    slot: d.slot,
    topic: d.topic || "",
    price_inr: MENTORING_PRICE_INR,
  });
  if (res.error) return { ok: false, error: res.error };
  return { ok: true, id: res.id };
}
