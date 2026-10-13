import { sendEnrollmentEmail } from "@/lib/emails/enrollment";
import { recordRegistration } from "@/lib/sheets";
import { upcoming, bySlug } from "@/lib/community/workshops";
import { loadPublicWorkshops } from "@/lib/community/publicWorkshops";

/* =============================================================================
   There is no waitlist. Everyone who registers is in.

   Seats used to be capped and the overflow waitlisted. That is gone: every
   new registration is REGISTERED (see takeSeat() in app/workshops/actions.js).
   This moves anyone still WAITLISTED on an upcoming workshop — from before
   the change, or let in by an older copy of the database function — onto the
   list, and tells each of them they're in.

   Server only: it uses the service-role client it is handed.

   Safe to call as often as you like. The update only matches rows that are
   still WAITLISTED and hands back exactly the rows it changed, so two calls
   at once can never both email the same person. Never throws.
   ============================================================================= */
export async function promoteWaitlisted(admin) {
  try {
    const { workshops, error: loadError } = await loadPublicWorkshops();
    if (loadError) {
      console.error(`[seats] ${loadError}`);
      return 0;
    }
    const slugs = upcoming(workshops).map((w) => w.slug);
    if (!slugs.length) return 0;

    const { data, error } = await admin
      .from("enrollments")
      .update({ status: "REGISTERED", updated_at: new Date().toISOString() })
      .eq("status", "WAITLISTED")
      .in("workshop_slug", slugs)
      .select("workshop_slug, name, email, whatsapp, status");

    if (error) {
      console.error(`[seats] Could not move the waitlist onto the list: ${error.message}`);
      return 0;
    }

    for (const r of data || []) {
      await sendEnrollmentEmail({ to: r.email, name: r.name, slug: r.workshop_slug, status: "REGISTERED" });
      await recordRegistration({
        slug: r.workshop_slug,
        workshopTitle: bySlug(r.workshop_slug, workshops)?.title || r.workshop_slug,
        name: r.name,
        email: r.email,
        whatsapp: r.whatsapp,
        status: "REGISTERED",
      });
    }
    return (data || []).length;
  } catch (e) {
    console.error(`[seats] Could not move the waitlist onto the list: ${e?.message || e}`);
    return 0;
  }
}
