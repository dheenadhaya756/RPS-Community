/* =============================================================================
   Who is looking at /review — shared by the server actions and the screenshot
   route, so both make exactly the same decision. Server only.
   ============================================================================= */

import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { isAdminUser } from "@/lib/admin";
import { isLaunched } from "@/lib/review/launch";

/* Local testing without logging in. Only in `npm run dev` (NODE_ENV is
   "production" in every build, so the live site can never take this path),
   and only when .env.local sets REVIEW_DEV_NO_AUTH=1. Everyone is then one
   pretend account; "Reset for testing" switches to a fresh one. */
export const DEV_NO_AUTH = process.env.NODE_ENV !== "production" && process.env.REVIEW_DEV_NO_AUTH === "1";
export const DEV_COOKIE = "rps_dev_tester";

/* The pretend account. "Reset for testing" gives the browser a new one (a
   cookie), so the one-free-review limit can be tried again and again. */
async function devUser() {
  const jar = await cookies();
  const which = jar.get(DEV_COOKIE)?.value || process.env.REVIEW_DEV_USER || "local-tester";
  return {
    id: "dev-" + String(which).replace(/[^a-z0-9-]/gi, "").slice(0, 40),
    email: "local-tester@localhost",
    app_metadata: {},
    user_metadata: { name: "Local tester" },
    isDev: true,
  };
}

/* { supabase, user } — the signed-in account, the pretend one in local
   testing, or user: null. */
export async function signedInUser() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if ((!user || error) && DEV_NO_AUTH) return { supabase, user: await devUser() };
  return { supabase, user: error ? null : user };
}

/* Whether this visitor may use portfolio review right now: everyone once it
   has launched; before that, admins (and the pretend tester locally) only. */
export async function reviewAccess() {
  const { supabase, user } = await signedInUser();
  const admin = !!user && (user.isDev || isAdminUser(user));
  return { supabase, user, admin, open: isLaunched() || admin };
}
