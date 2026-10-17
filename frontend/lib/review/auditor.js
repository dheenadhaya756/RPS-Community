/* The review engine (portfolio-auditor/rps_api.py) runs as its own local
   service: a headless browser opens the portfolio and Gemini scores it against
   the RPS Review Base. Only the Next.js server talks to it — the browser never
   learns its address, and every call carries the signed-in user's id so one
   person can't read another's report. */

const AUDITOR_URL = (process.env.AUDITOR_URL || "http://127.0.0.1:8765").replace(/\/$/, "");

function headers() {
  const h = { "Content-Type": "application/json" };
  if (process.env.AUDITOR_TOKEN) h["X-Auditor-Token"] = process.env.AUDITOR_TOKEN;
  return h;
}

/* Starts a review. Resolves to { id }, { limit: true } when the engine counts
   the daily allowance as used, or { error }. `dailyLimit` and `since` let the
   engine enforce the allowance under its own lock, so parallel requests can't
   all get past the site's count. */
export async function startAudit(url, userId, caseStudyUrl = "", { dailyLimit, since } = {}) {
  try {
    const res = await fetch(`${AUDITOR_URL}/audits`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        url,
        user_id: userId,
        case_study_url: caseStudyUrl || null,
        daily_limit: dailyLimit || null,
        since: since ?? null,
      }),
      cache: "no-store",
    });
    const body = await res.json().catch(() => ({}));
    if (res.status === 429) return { limit: true };
    if (res.status === 422) return { error: body.detail || "That link doesn’t look right." };
    if (!res.ok) throw new Error(`auditor ${res.status}`);
    return { id: body.id };
  } catch (err) {
    console.error("[review] Could not reach the review engine:", err.message);
    return { error: "Our reviewer isn’t running right now. Please try again in a few minutes." };
  }
}

/* A review's progress, and the report once it's done. Resolves to the job, or
   { notFound } for an id that isn't this user's, or { error } if unreachable. */
export async function readAudit(id, userId) {
  try {
    const res = await fetch(
      `${AUDITOR_URL}/audits/${encodeURIComponent(id)}?user_id=${encodeURIComponent(userId)}`,
      { headers: headers(), cache: "no-store" }
    );
    if (res.status === 404) return { notFound: true };
    if (!res.ok) throw new Error(`auditor ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error("[review] Could not read a review:", err.message);
    return { error: "We can’t reach our reviewer right now. This page will keep trying." };
  }
}

/* The review this account already has, if any: { review: {id, url, status} },
   { review: null }, or { error } if the engine can't be reached. Failed
   reviews aren't returned — they don't use up the one free review. */
export async function latestForUser(userId) {
  try {
    const res = await fetch(`${AUDITOR_URL}/users/${encodeURIComponent(userId)}/review`, {
      headers: headers(),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`auditor ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error("[review] Could not check for an earlier review:", err.message);
    return { error: "Our reviewer isn’t running right now. Please try again in a few minutes." };
  }
}

/* One of a report's screenshots, as the engine's own response (an image), or
   null. The engine checks the report belongs to this user. */
export async function readShot(id, n, userId) {
  try {
    const res = await fetch(
      `${AUDITOR_URL}/audits/${encodeURIComponent(id)}/shots/${encodeURIComponent(n)}?user_id=${encodeURIComponent(userId)}`,
      { headers: headers(), cache: "no-store" }
    );
    return res.ok ? res : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------ 1:1 bookings
   Stored by the same engine (portfolio-auditor/rps_api.py). Each resolves to
   the engine's JSON, or { error } if it can't be reached. */
async function call(path, init = {}) {
  try {
    const res = await fetch(`${AUDITOR_URL}${path}`, { ...init, headers: headers(), cache: "no-store" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { error: body.detail || `engine ${res.status}` };
    return body;
  } catch (err) {
    console.error("[bookings] Could not reach the engine:", err.message);
    return { error: "We can’t take bookings right now. Please try again in a few minutes." };
  }
}

export const createBookingReq = (b) => call("/bookings", { method: "POST", body: JSON.stringify(b) });
export const listBookingsReq = (userId) =>
  call("/bookings" + (userId ? `?user_id=${encodeURIComponent(userId)}` : ""));
export const patchBookingReq = (id, patch) =>
  call(`/bookings/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) });

/* This account's reviews since a moment (epoch seconds) — the daily limit
   counts these. Resolves to { reviews: [...] } or { error }. */
export async function reviewsSince(userId, sinceSec) {
  try {
    const res = await fetch(
      `${AUDITOR_URL}/users/${encodeURIComponent(userId)}/reviews?since=${encodeURIComponent(sinceSec)}`,
      { headers: headers(), cache: "no-store" }
    );
    if (!res.ok) throw new Error(`auditor ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error("[review] Could not count today's reviews:", err.message);
    return { error: "Our reviewer isn’t running right now. Please try again in a few minutes." };
  }
}
