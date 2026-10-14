"use server";

import { createClient, createAdminClient } from "@/lib/supabase/server";
import { enrollmentSchema } from "@/lib/validation";
import { sendEnrollmentEmail } from "@/lib/emails/enrollment";
import { recordRegistration } from "@/lib/sheets";
import { promoteWaitlisted } from "@/lib/seats";
import { isPast } from "@/lib/community/workshops";
import { loadPublicWorkshop } from "@/lib/community/publicWorkshops";

// Server Actions for workshop seats. Registering needs an account and a
// signed-in session: the client can only influence the form fields, and who
// the seat belongs to comes from the verified session, never the browser.
//
// There is no waitlist and no cap: everyone who registers is in. takeSeat()
// writes REGISTERED with the service-role client. The old public.enroll_in_workshop() database function, which
// waitlisted anyone past capacity, is no longer called.

/* Insert the seat row for a workshop the content module knows about and the
   database does not — enrollments.workshop_slug references it. Only for real,
   still-upcoming workshops, so a made-up slug from the browser can never
   create a row. `ignoreDuplicates` makes it `on conflict do nothing`: a row
   someone has edited by hand is left alone. Never throws. */
async function ensureSeatRow(admin, w) {
  if (!w || isPast(w)) return false;
  try {
    const { error } = await admin
      .from("workshop_seats")
      .upsert(
        { slug: w.slug, capacity: w.capacity || 45, seeded_enrollments: 0 },
        { onConflict: "slug", ignoreDuplicates: true }
      );
    if (error) {
      console.error(`[enroll] Could not add the seat row for ${w.slug}: ${error.message}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error(`[enroll] Could not add the seat row for ${w.slug}: ${e?.message || e}`);
    return false;
  }
}

/* Put one account on a workshop's list. Returns { row, isNew } or { error }.

   - Already registered (or attended): hands back that row, no second email.
   - Still WAITLISTED from before there was no waitlist: moved onto the list,
     and counted as new so they get the "You're in" email.
   - Taken off the list by an admin (CANCELLED / REJECTED): left as the admin
     left it. Putting someone back is the admins' call, from the trash.
   - Otherwise: a new REGISTERED row. The unique (user_id, workshop_slug)
     constraint means two submits at once still make one row. */
async function takeSeat(admin, { userId, userEmail, slug, name, email, whatsapp, workshop }) {
  const read = () =>
    admin.from("enrollments").select("*").eq("user_id", userId).eq("workshop_slug", slug).maybeSingle();

  const { data: existing } = await read();
  if (existing) {
    if (existing.status === "REGISTERED" || existing.status === "ATTENDED") {
      return { row: existing, isNew: false };
    }
    // Declined by the team: registering again doesn't overturn that.
    if (existing.status === "REJECTED") return { rejected: true };

    /* WAITLISTED (from before there was no waitlist) or CANCELLED (taken off
       the list, then registered again): they're asking to be in, so they are
       — with today's details, and the "you're in" email as for anyone new. */
    const { data: back } = await admin
      .from("enrollments")
      .update({
        status: "REGISTERED",
        name: name.trim(),
        email,
        whatsapp: whatsapp.trim(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
      .eq("status", existing.status)
      .select("*")
      .maybeSingle();
    return { row: back || { ...existing, status: "REGISTERED" }, isNew: !!back };
  }

  const { data: seatRow } = await admin.from("workshop_seats").select("slug").eq("slug", slug).maybeSingle();
  if (!seatRow && !(await ensureSeatRow(admin, workshop))) {
    return { error: "no seat row" };
  }

  const { data: row, error } = await admin
    .from("enrollments")
    .insert({
      user_id: userId,
      workshop_slug: slug,
      status: "REGISTERED",
      name: name.trim(),
      email,
      whatsapp: whatsapp.trim(),
      user_email: userEmail || email,
    })
    .select("*")
    .single();

  if (error) {
    if (error.code === "23505") {
      const { data: again } = await read();
      if (again) return { row: again, isNew: false };
    }
    return { error: error.message };
  }
  return { row, isNew: true };
}

/* Everything that follows a seat being taken.

   Tell them it worked. Awaited rather than left running, because a serverless
   function stops executing the moment it returns a response — a floating
   promise here would be cancelled about as often as it completed. It cannot
   fail the enrolment: the seat is already saved, sendEnrollmentEmail never
   throws, and its result is logged rather than returned.

   The sheet, unlike the email, is written on every successful enrol, not
   only a new one: it keys on workshop + email and updates in place, so a
   repeat is a no-op that also repairs a row which failed to write.

   Last, anyone still waitlisted on an upcoming workshop is moved onto the
   list — a no-op once there is nobody left to move. */
async function afterSeat(admin, { slug, row, isNew, typed }) {
  const name = row?.name || typed.name;
  const email = row?.email || typed.email;
  const whatsapp = row?.whatsapp || typed.whatsapp;
  const status = row?.status || "REGISTERED";

  if (isNew) {
    const sent = await sendEnrollmentEmail({ to: email, name, slug, status });
    if (!sent.ok && !sent.skipped) {
      console.error(`[enroll] Seat saved for ${slug}, but the confirmation did not send.`);
    }
  }

  await recordRegistration({
    slug,
    workshopTitle: (await loadPublicWorkshop(slug)).workshop?.title || slug,
    name,
    email,
    whatsapp,
    status,
  });

  await promoteWaitlisted(admin);

  return {
    ok: true,
    status,
    enrollment: row
      ? {
          slug: row.workshop_slug,
          status: row.status,
          name: row.name,
          email: row.email,
          whatsapp: row.whatsapp,
          enrolledAt: row.created_at,
        }
      : null,
  };
}

function adminClient() {
  try {
    return createAdminClient();
  } catch {
    return null;
  }
}

const COULD_NOT = "Could not save your seat. Please try again.";

/* Take a seat while signed in. Identity is the verified session; the three
   fields are what the person typed on the form. */
export async function enrollInWorkshop(input) {
  const parsed = enrollmentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message || "Invalid input." };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { ok: false, error: "You must be signed in to take a seat." };
  }

  const { slug, name, email, whatsapp } = parsed.data;
  const { workshop: w, error: loadError } = await loadPublicWorkshop(slug);
  if (loadError) return { ok: false, error: "Could not load that workshop. Please try again." };
  if (!w || isPast(w)) return { ok: false, error: "That workshop isn’t taking seats." };

  const admin = adminClient();
  if (!admin) {
    // No service-role key on this server: fall back to the database function
    // so a signed-in person can still register at all. Logged, because it is
    // the one path that can still waitlist past the workshop's capacity.
    console.error("[enroll] SUPABASE_SERVICE_ROLE_KEY missing; using enroll_in_workshop().");
    const { data, error } = await supabase.rpc("enroll_in_workshop", {
      p_slug: slug,
      p_name: name,
      p_email: email,
      p_whatsapp: whatsapp,
    });
    if (error) return { ok: false, error: COULD_NOT };
    const row = Array.isArray(data) ? data[0] : data;
    return {
      ok: true,
      status: row?.status || "REGISTERED",
      enrollment: row
        ? { slug: row.workshop_slug, status: row.status, name: row.name, email: row.email, whatsapp: row.whatsapp, enrolledAt: row.created_at }
        : null,
    };
  }

  const res = await takeSeat(admin, { userId: user.id, userEmail: user.email, slug, name, email, whatsapp, workshop: w });
  if (res.rejected) {
    return {
      ok: false,
      error: "We couldn’t register you for this one. Write to cohorts@rockpaperscissors.studio if that’s a mistake.",
    };
  }
  if (res.error) {
    console.error(`[enroll] Seat for ${slug} failed: ${res.error}`);
    return { ok: false, error: COULD_NOT };
  }
  return afterSeat(admin, { slug, row: res.row, isNew: res.isNew, typed: { name, email, whatsapp } });
}

export async function cancelEnrollment(slug) {
  const clean = String(slug || "").trim();
  if (!/^[a-z0-9-]+$/.test(clean)) {
    return { ok: false, error: "Missing workshop." };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { ok: false, error: "You must be signed in to do that." };
  }

  // Read the row before it goes: cancel_enrollment() deletes it outright, so
  // after this call there is nothing left to name in the sheet.
  const { data: leaving } = await supabase
    .from("enrollments")
    .select("name, email, whatsapp")
    .eq("workshop_slug", clean)
    .maybeSingle();

  const { error } = await supabase.rpc("cancel_enrollment", { p_slug: clean });
  if (error) {
    return { ok: false, error: "Could not release your seat. Please try again." };
  }

  // Mark them CANCELLED rather than deleting the row. Someone reading the sheet
  // to send out Meet links needs to see that a name came off the list, not find
  // it silently absent — and a row that merely vanished looks like a bug.
  if (leaving?.email) {
    await recordRegistration({
      slug: clean,
      workshopTitle: (await loadPublicWorkshop(clean)).workshop?.title || clean,
      name: leaving.name,
      email: leaving.email,
      whatsapp: leaving.whatsapp,
      status: "CANCELLED",
    });
  }

  return { ok: true };
}
