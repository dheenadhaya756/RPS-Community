import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdminUser } from "@/lib/admin";

export async function requireWorkshopsAdmin(nextPath) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/signin?next=${nextPath}`);
  if (!isAdminUser(user)) notFound();
  return user;
}
