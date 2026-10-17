"use server";

import { revalidatePath } from "next/cache";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { isAdminUser } from "@/lib/admin";

/* Approving, rejecting, removing and restoring a registration.

   The admin check runs in here, not only around the buttons. A Server Action is
   a POST endpoint anybody can call once they know its name, so rendering a
   control behind a check protects the control and not the data.

   Writes go through the service-role client because `enrollments` has no update
   policy at all — every ordinary change is made by the SECURITY DEFINER
   functions in supabase/enrollments.sql. Admin overrides are the exception. */

/* supabase/admin-moderation.sql adds REJECTED to the status constraint, plus
   removed_by / removed_at. None of this requires it: if the migration has not
   been run, the audit columns are dropped from the write and REJECTED falls
   back to CANCELLED, which is the closest thing the schema already has. The
   page keeps working either way — nobody should lose the ability to remove a
   registration because a SQL file went unrun. */
const MISSING_COLUMN = /column .* does not exist|could not find the .* column/i;
const BAD_STATUS = /violates check constraint .*status/i;

async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isAdminUser(user)) return null;
  return user;
}

function validId(id) {
  return /^[0-9a-f-]{36}$/i.test(String(id || ""));
}

/* One update, retried without whatever the schema turned out not to have.
   Returns { data, error, degraded } — `degraded` naming what was dropped, so
   the page can say so rather than quietly doing something else. */
async function writeStatus(id, patch, fallbackStatus) {
  const admin = createAdminClient();

  let res = await admin
    .from("enrollments")
    .update(patch)
    .eq("id", id)
    .select("id, name, status")
    .maybeSingle();

  if (res.error && MISSING_COLUMN.test(res.error.message)) {
    const { removed_by, removed_at, ...rest } = patch;
    res = await admin
      .from("enrollments")
      .update(rest)
      .eq("id", id)
      .select("id, name, status")
      .maybeSingle();
    if (!res.error) return { ...res, degraded: "audit" };
  }

  if (res.error && fallbackStatus && BAD_STATUS.test(res.error.message)) {
    const { removed_by, removed_at, ...rest } = patch;
    res = await admin
      .from("enrollments")
      .update({ ...rest, status: fallbackStatus })
      .eq("id", id)
      .select("id, name, status")
      .maybeSingle();
    if (!res.error) return { ...res, degraded: "status" };
  }

  return res;
}

/* ------------------------------------------------------- approve / reject */

export async function setEnrollmentStatus(id, status) {
  const user = await requireAdmin();
  if (!user) return { ok: false, error: "Not allowed." };
  if (!validId(id)) return { ok: false, error: "Missing registration." };

  // The two an admin decides. There is no waitlist; ATTENDED is a record of
  // what happened, and CANCELLED belongs to the registrant.
  if (!["REGISTERED", "REJECTED"].includes(status)) {
    return { ok: false, error: "That is not a status you can set here." };
  }

  const rejecting = status === "REJECTED";
  const patch = rejecting
    ? { status, updated_at: new Date().toISOString(), removed_by: user.email, removed_at: new Date().toISOString() }
    : { status, updated_at: new Date().toISOString(), removed_by: null, removed_at: null };

  const { data, error, degraded } = await writeStatus(id, patch, rejecting ? "CANCELLED" : null);

  if (error) {
    console.error(`[admin] Could not set ${id} to ${status}: ${error.message}`);
    return { ok: false, error: "Could not save that. Please try again." };
  }
  if (!data) return { ok: false, error: "That registration is no longer there." };

  revalidatePath("/admin/registrations");
  return {
    ok: true,
    status: data.status,
    name: data.name,
    // Told, not hidden: the page says what happened instead of what was asked.
    degraded:
      degraded === "status"
        ? "Recorded as removed rather than rejected — run supabase/admin-moderation.sql to tell the two apart."
        : degraded === "audit"
          ? "Saved, but without a name against it — run supabase/admin-moderation.sql to record who."
          : null,
  };
}

/* -------------------------------------------------------------- remove */

/* Marks the row CANCELLED rather than deleting it. Removing the wrong person
   from a list of names is an easy mistake and an unrecoverable one if the row
   is gone. It also frees the seat — capacity counts REGISTERED and ATTENDED
   only — which is what removing somebody ought to mean. */
export async function removeEnrollment(id) {
  const user = await requireAdmin();
  if (!user) return { ok: false, error: "Not allowed." };
  if (!validId(id)) return { ok: false, error: "Missing registration." };

  const now = new Date().toISOString();
  const { data, error, degraded } = await writeStatus(id, {
    status: "CANCELLED",
    updated_at: now,
    removed_by: user.email,
    removed_at: now,
  });

  if (error) {
    console.error(`[admin] Could not remove ${id}: ${error.message}`);
    return { ok: false, error: "Could not remove that. Please try again." };
  }
  if (!data) return { ok: false, error: "That registration is no longer there." };

  console.warn(`[admin] ${user.email} removed registration ${id} (${data.name}).`);
  revalidatePath("/admin/registrations");
  return {
    ok: true,
    name: data.name,
    degraded: degraded === "audit"
      ? "Removed, but without a name against it — run supabase/admin-moderation.sql to record who."
      : null,
  };
}

/* ------------------------------------------------------------- restore */

/* Back onto the list, approved. There is no waitlist and no cap on the room,
   so a restored registration is simply in again. */
export async function restoreEnrollment(id) {
  const user = await requireAdmin();
  if (!user) return { ok: false, error: "Not allowed." };
  if (!validId(id)) return { ok: false, error: "Missing registration." };

  const { data, error } = await writeStatus(id, {
    status: "REGISTERED",
    updated_at: new Date().toISOString(),
    removed_by: null,
    removed_at: null,
  });

  if (error) {
    console.error(`[admin] Could not restore ${id}: ${error.message}`);
    return { ok: false, error: "Could not restore that. Please try again." };
  }
  if (!data) return { ok: false, error: "That registration is no longer there." };

  console.warn(`[admin] ${user.email} restored registration ${id} (${data.name}).`);
  revalidatePath("/admin/registrations");
  return { ok: true, name: data.name };
}

/* ------------------------------------------------------- email everyone */

const SENDABLE = ["REGISTERED", "ATTENDED"];
const SPACING_MS = 550; // Resend allows about two requests a second
const BUDGET_MS = 50_000; // stop short of the function's 60s limit

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Send one message to everyone approved on a workshop's list, or — with
   `test` — only to the admin pressing the button, so it can be checked in a
   real inbox first.

   Each person's copy carries an idempotency key made from the workshop, the
   exact subject and body, and their address. Resend sends a key once per 24
   hours, so pressing Send twice, or again after a timeout, reaches only the
   people who have not had it yet. Change a word and it is a new message.

   Long lists are sent at Resend's pace and stopped before the server's time
   limit; the reply says how many are left, and pressing Send again finishes
   them without repeating anyone. */
export async function sendWorkshopEmail({ slug, subject, body, test = false, testTo = "", skip = [] }) {
  const user = await requireAdmin();
  if (!user) return { ok: false, error: "Not allowed." };

  const { loadAllWorkshops } = await import("@/lib/community/publicWorkshops");
  const { PLACEHOLDER } = await import("@/lib/emails/templates");
  const { buildBroadcastEmail } = await import("@/lib/emails/broadcast");
  const { openMailer, mailConfigured, mailProvider } = await import("@/lib/mail");
  const { createHash } = await import("crypto");

  const { workshops, error: workshopError } = await loadAllWorkshops();
  if (workshopError) return { ok: false, error: "Could not load that workshop. Please try again." };
  const w = (workshops || []).find((item) => item.slug === String(slug || ""));
  if (!w) return { ok: false, error: "Pick a workshop first." };

  const subj = String(subject || "").trim();
  const text = String(body || "").replace(/\r\n/g, "\n").trim();
  if (subj.length < 3 || subj.length > 200) return { ok: false, error: "Give it a subject." };
  if (text.length < 10 || text.length > 10000) return { ok: false, error: "The message is empty." };
  const left = (subj + "\n" + text).match(PLACEHOLDER);
  if (left) return { ok: false, error: `Fill in ${left[0]} before sending.` };

  if (!mailConfigured()) {
    return {
      ok: false,
      error:
        "Email isn’t set up on the server yet: add GMAIL_USER and GMAIL_APP_PASSWORD (or RESEND_API_KEY) in Vercel, then redeploy.",
    };
  }

  let people;
  if (test) {
    const to = testAddress(testTo, user.email);
    if (!to) return { ok: false, error: "That test address doesn’t look right." };
    people = [{ name: to.split("@")[0], email: to }];
  } else {
    const { data, error } = await createAdminClient()
      .from("enrollments")
      .select("name, email, status")
      .eq("workshop_slug", w.slug)
      .in("status", SENDABLE);
    if (error) return { ok: false, error: "Could not read the list. Please try again." };
    const seen = new Set();
    people = (data || []).filter((r) => {
      const e = String(r.email || "").trim().toLowerCase();
      if (!e || seen.has(e)) return false;
      seen.add(e);
      return true;
    });
  }
  if (!people.length) return { ok: false, error: "Nobody approved on this list yet." };

  /* Who has already had this exact message, as remembered by the page that
     sent it — so a second press, or a press after a timeout, carries on with
     the rest rather than starting again. (With Resend the idempotency key
     below guarantees it on the provider's side too; Gmail has no such thing.) */
  const already = new Set((Array.isArray(skip) ? skip : []).map((e) => String(e).trim().toLowerCase()));
  const total = people.length;
  if (!test) people = people.filter((r) => !already.has(String(r.email).trim().toLowerCase()));
  const hadIt = total - people.length;
  if (!people.length) return { ok: true, test, total, sent: hadIt, sentTo: [], failed: [], remaining: 0, done: true };

  const mailer = await openMailer();
  if (!mailer.ok) return { ok: false, error: `Could not sign in to send: ${mailer.error}` };
  const spacing = mailProvider() === "resend" ? SPACING_MS : 150;

  const started = Date.now();
  let sent = 0;
  const sentTo = [];
  const failed = [];
  let remaining = 0;

  for (let i = 0; i < people.length; i++) {
    if (Date.now() - started > BUDGET_MS) {
      remaining = people.length - i;
      break;
    }
    const r = people[i];
    const email = String(r.email).trim();
    const msg = buildBroadcastEmail({ name: r.name, workshop: w, subject: subj, body: text });
    const key =
      "rps-" +
      createHash("sha256")
        .update([w.slug, subj, text, email.toLowerCase(), test ? `test-${started}` : ""].join("\u0000"))
        .digest("hex")
        .slice(0, 48);

    let res;
    for (let attempt = 0; attempt < 3; attempt++) {
      res = await mailer.send({ to: email, ...msg, idempotencyKey: key });
      if (res.ok || res.status !== 429) break;
      await sleep(1200 * (attempt + 1));
    }
    if (res.ok) {
      sent += 1;
      sentTo.push(email.toLowerCase());
    } else failed.push(email);
    if (i < people.length - 1) await sleep(spacing);
  }
  mailer.close();

  return { ok: true, test, total, sent: sent + hadIt, sentTo, failed, remaining };
}

/* Where a test goes: the address typed in the test box, or the admin's own. */
function testAddress(typed, fallback) {
  const to = String(typed || fallback || "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(to) ? to : null;
}

/* The "Congratulations, you're in" mail exactly as a registrant gets it, sent
   to a test address — so it can be checked in a real inbox without
   registering for the workshop. */
export async function sendConfirmationTest({ slug, testTo = "" }) {
  const user = await requireAdmin();
  if (!user) return { ok: false, error: "Not allowed." };

  const { mailConfigured } = await import("@/lib/mail");
  const { sendEnrollmentEmail } = await import("@/lib/emails/enrollment");
  if (!mailConfigured()) {
    return {
      ok: false,
      error:
        "Email isn’t set up on the server yet: add GMAIL_USER and GMAIL_APP_PASSWORD (or RESEND_API_KEY) in Vercel, then redeploy.",
    };
  }
  const to = testAddress(testTo, user.email);
  if (!to) return { ok: false, error: "That test address doesn’t look right." };

  const res = await sendEnrollmentEmail({ to, name: to.split("@")[0], slug: String(slug || "") });
  return res.ok ? { ok: true, to } : { ok: false, error: res.error || "Could not send it." };
}
