import { reviewAccess } from "@/lib/review/viewer";
import { loadPublicWorkshops } from "@/lib/community/publicWorkshops";
import { upcoming, enrollUrl } from "@/lib/community/workshops";

/* For the /review pages: may this visitor use it yet? If not, the cohort the
   "something is cooking" page points to — whichever is next. Server only. */
export async function reviewGate({ preview = false } = {}) {
  const { open } = await reviewAccess();
  if (open && !preview) return { open: true };
  let cohort = null;
  try {
    const { workshops } = await loadPublicWorkshops();
    const next = upcoming(workshops || [])[0];
    if (next) {
      cohort = { label: next.cohortLabel || "the next cohort", title: next.title, href: enrollUrl(next) };
    }
  } catch {
    /* no cohort to point at: the page falls back to /workshops */
  }
  return { open: open && !preview, cohort };
}
