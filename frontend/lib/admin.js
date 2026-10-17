/* =============================================================================
   Who can see the registration list.

   The list holds every registrant's name, email and WhatsApp number, so this is
   the only thing standing between that and anyone with an account. It is
   deliberately a short allow-list rather than a role on the profile: a role is
   editable from the database by anyone who can reach it, and there is no
   admin UI to grant one through anyway.

   Set ADMIN_EMAILS to change it — comma-separated, no NEXT_PUBLIC_ prefix, or
   the list of who is privileged ships to every browser. Setting it REPLACES the
   fallback below rather than adding to it, so an address left out of the
   variable loses access even if it is named here.

   With it unset the fallback applies: named people rather than nobody, so the
   page is never locked out and never open.
   ============================================================================= */

const FALLBACK = [
  "avni@rockpaperscissors.studio",
  "dheena@rockpaperscissors.studio",
  "rishi@rockpaperscissors.studio",
  "vivin@rockpaperscissors.studio",
  "darshit@rockpaperscissors.studio",
];

function parse(raw) {
  return String(raw || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function adminEmails() {
  const configured = parse(process.env.ADMIN_EMAILS);
  return configured.length ? configured : FALLBACK;
}

/* Case-insensitive, and false for anything that is not a non-empty string —
   an undefined email must never match an undefined entry. */
export function isAdminEmail(email) {
  const e = String(email || "").trim().toLowerCase();
  if (!e) return false;
  return adminEmails().includes(e);
}

/* An admin is an allow-listed address that the account has confirmed it
   owns. Without the confirmation check, someone could sign up with an admin's
   address before that admin ever logs in. (This only holds while Supabase's
   "Confirm email" is ON: with it off, Supabase marks every sign-up confirmed.) */
export function isAdminUser(user) {
  if (!user || !(user.email_confirmed_at || user.confirmed_at)) return false;
  return isAdminEmail(user.email);
}
