import { notFound, redirect } from "next/navigation";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { isAdminUser } from "@/lib/admin";
import HostsClient from "./HostsClient";

export const metadata = {
  title: "Hosts — RPS Cohorts",
  robots: { index: false, follow: false, nocache: true },
};

function fromRow(row) {
  return {
    id: row.id,
    name: row.name || "",
    title: row.title || "",
    bio: row.bio || "",
    role: row.role || "",
    years: row.years ?? "",
    photoUrl: row.photo_url || "",
    portraitUrl: row.portrait_url || "",
  };
}

// Same gate as the other admin pages: signed out goes to sign-in, anyone else
// gets a 404. The list comes only from the hosts table.
export default async function HostsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/signin?next=/admin/hosts");
  if (!isAdminUser(user)) notFound();

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("hosts")
    .select("id, name, title, bio, role, years, photo_url, portrait_url")
    .order("created_at", { ascending: false });

  if (error) console.error("hosts list failed", error.message);

  return (
    <HostsClient
      viewer={user.email}
      initialHosts={error ? [] : (data || []).map(fromRow)}
      loadError={error ? "Could not load the hosts." : ""}
    />
  );
}
