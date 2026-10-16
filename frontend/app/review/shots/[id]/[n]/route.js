import { signedInUser } from "@/lib/review/viewer";
import { readShot } from "@/lib/review/auditor";
import { loadSavedReport, loadSavedShot } from "@/lib/review/report-store";

/* A screenshot from a report — what the reviewer saw. Private like the report:
   it is fetched from the review engine on the viewer's behalf, and the engine
   only hands it over to the account the report belongs to. */
export async function GET(_req, { params }) {
  const { id, n } = await params;
  if (!/^[a-f0-9]{32}$/.test(String(id)) || !/^\d{1,2}$/.test(String(n))) {
    return new Response("Not found", { status: 404 });
  }
  const { user } = await signedInUser();
  if (!user) return new Response("Log in to see this.", { status: 401 });

  // From Supabase when the report has been saved there (ownership checked).
  const saved = await loadSavedReport(id, user.id);
  if (saved?.notFound) return new Response("Not found", { status: 404 });
  if (saved) {
    const bytes = await loadSavedShot(id, n);
    if (bytes) {
      return new Response(bytes, {
        headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=86400" },
      });
    }
  }

  const shot = await readShot(id, n, user.id);
  if (!shot) return new Response("Not found", { status: 404 });
  return new Response(await shot.arrayBuffer(), {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=86400" },
  });
}
