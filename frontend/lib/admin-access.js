"use server";

import { createClient } from "@/lib/supabase/server";
import { isAdminUser } from "@/lib/admin";

// Whether the signed-in session is an admin. The browser only receives
// true or false — never the allow-list, and never an email it supplied.
export async function currentUserIsAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return !!(user && isAdminUser(user));
}
