import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { siteOrigin, requestOrigin } from "@/lib/site-url";

// Handles the OAuth / email-link redirect: exchanges the `code` for a session
// cookie, then forwards the user on to `next` (default /dashboard).
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  // NOT `new URL(request.url).origin` — behind Vercel's proxy that is the
  // internal *.vercel.app host, which is how a login that started on the
  // custom domain used to finish on the deployment URL.
  const origin = siteOrigin(requestOrigin(request));
  const code = searchParams.get("code");
  const next = searchParams.get("next") || "/dashboard";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // First-time OAuth users have a profile row (created by the DB trigger)
      // but haven't sent the signup form yet. Send them through it first —
      // unless they were on their way to a workshop, where the seat form asks
      // for the name, email and number it needs and nothing is waiting on a
      // profile. Same rule as hasCompletedOnboarding in
      // lib/supabase/middleware.js, and ONBOARDING_EXEMPT there.
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const nextPath = next.split(/[?#]/)[0];
      const skipOnboarding =
        nextPath === "/workshops" || nextPath.startsWith("/workshops/");
      const meta = user?.user_metadata || {};
      if (user && !skipOnboarding && !meta.onboarded && !meta.role) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("role, terms_accepted_at")
          .eq("id", user.id)
          .single();
        if (!profile?.role && !profile?.terms_accepted_at) {
          return NextResponse.redirect(
            `${origin}/onboarding?mode=complete&next=${encodeURIComponent(next)}`
          );
        }
      }
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/signin?error=auth`);
}
