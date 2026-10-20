/* =============================================================================
   When portfolio review opens to everyone. Until then the public sees the
   "something is cooking" countdown and only admins can use it (see
   reviewAccess() in lib/review/viewer.js). After it, nothing changes — the
   page simply opens; no redeploy needed.

   Change NEXT_PUBLIC_REVIEW_LAUNCH_AT to move it (an ISO time with offset).
   Client-safe.
   ============================================================================= */

export const LAUNCH_AT =
  process.env.NEXT_PUBLIC_REVIEW_LAUNCH_AT || "2026-10-17T15:00:00+05:30";

/* Paused: everyone except admins sees "Launching in a few days" (no countdown)
   while the backend is being updated. Admins keep full access to test. Set it
   back to false to reopen portfolio review to everyone. */
export const PAUSED = true;

export function isLaunched(now = Date.now()) {
  if (PAUSED) return false;
  return now >= new Date(LAUNCH_AT).getTime();
}

/* "Sat 17 Oct, 3:00 PM IST" */
export function launchLabel() {
  const d = new Date(LAUNCH_AT);
  const p = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short",
    hour: "numeric", minute: "2-digit", hour12: true,
  }).formatToParts(d).reduce((a, x) => ((a[x.type] = x.value), a), {});
  return `${p.weekday} ${p.day} ${p.month}, ${p.hour}:${p.minute} ${String(p.dayPeriod).toUpperCase()} IST`;
}
