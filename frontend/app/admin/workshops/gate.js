import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/admin";

export async function requireWorkshopsAdmin(nextPath) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/signin?next=${nextPath}`);
  if (!isAdminEmail(user.email)) notFound();
  return user;
}
