import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/server";
import { formatSize } from "@/app/admin/workshops/pdfNotes";

/* Active workshops for the public site. A draft is not in this list, so it
   cannot appear on the homepage, the workshop list, or its own page. */

function lines(value) {
  return Array.isArray(value) ? value.map((item) => String(item)).filter((item) => item.trim()) : [];
}

function hostOf(row) {
  const host = Array.isArray(row) ? row[0] : row;
  if (!host) return null;
  row = host;
  return {
    id: row.id,
    name: row.name || "",
    title: row.title || "",
    role: row.role || "",
    bio: row.bio || "",
    years: row.years ?? "",
    photoUrl: row.photo_url || "",
    portraitUrl: row.portrait_url || "",
  };
}

function quotesOf(rows, workshopId) {
  return rows.map((item) => ({
    id: item.id,
    workshopId,
    name: item.name || "",
    role: item.role || "",
    quote: item.quote || "",
    featured: !!item.featured,
  }));
}

function notesOf(row) {
  if (!row.notes_file_url) return [];
  return [
    {
      id: "notes",
      title: row.notes_title || "The workshop notes",
      description: row.notes_description || "",
      type: "pdf",
      fileUrl: row.notes_file_url,
      fileName: row.notes_file_name || "notes.pdf",
      pages: row.notes_pages ?? "",
      size: row.notes_size_bytes == null ? "" : formatSize(Number(row.notes_size_bytes)),
    },
  ];
}

function workshopOf(row, hosts, quotes) {
  const recap = lines(row.recap);
  return {
    id: row.id,
    slug: row.slug,
    status: row.status,
    cohortLabel: row.cohort_label || "",
    title: row.title || "",
    summary: row.summary || "",
    pitch: row.pitch || "",
    description: lines(row.description),
    recap: recap.length ? recap : null,
    recapHeadline: null,
    whoItsFor: lines(row.who_its_for),
    curriculumTitle: row.curriculum_title || "",
    curriculum: lines(row.curriculum),
    dateTime: row.date_time || "",
    durationMins: row.duration_mins ?? 120,
    capacity: row.capacity ?? 45,
    bannerUrl: row.banner_url || "",
    emailBannerUrl: row.email_banner_url || "",
    meetLink: row.meet_link || null,
    meetPhone: row.dial_number
      ? { number: row.dial_number, pin: row.dial_pin || "", country: "" }
      : null,
    recordingUrl: row.recording_url || null,
    hostIds: hosts.map((host) => host.id),
    hosts,
    resources: notesOf(row),
    quotes,
  };
}

async function readWorkshops(onlyActive) {
  const admin = createAdminClient();
  let query = admin.from("workshops").select("*").order("date_time", { ascending: true });
  if (onlyActive) query = query.eq("status", "active");
  const { data, error } = await query;
  if (error) {
    console.error("public workshops failed", error.message);
    return { workshops: [], error: "Could not load the workshops." };
  }
  const rows = data || [];
  if (!rows.length) return { workshops: [], error: "" };

  const ids = rows.map((row) => row.id);
  const [{ data: links, error: linkError }, { data: quotes, error: quoteError }] = await Promise.all([
    admin
      .from("workshop_hosts")
      .select("workshop_id, position, hosts(id, name, title, bio, role, years, photo_url, portrait_url)")
      .in("workshop_id", ids)
      .order("position"),
    admin
      .from("workshop_testimonials")
      .select("id, workshop_id, position, name, role, quote, featured")
      .in("workshop_id", ids)
      .order("position"),
  ]);
  if (linkError || quoteError) {
    console.error("public hosts or quotes failed", linkError?.message || quoteError?.message);
    return { workshops: [], error: "Could not load the workshops." };
  }

  const hostsByWorkshop = new Map();
  for (const link of links || []) {
    const host = hostOf(link.hosts);
    if (!host) continue;
    const list = hostsByWorkshop.get(link.workshop_id) || [];
    list.push(host);
    hostsByWorkshop.set(link.workshop_id, list);
  }
  const quotesByWorkshop = new Map();
  for (const quote of quotes || []) {
    const list = quotesByWorkshop.get(quote.workshop_id) || [];
    list.push(quote);
    quotesByWorkshop.set(quote.workshop_id, list);
  }

  return {
    workshops: rows.map((row) =>
      workshopOf(row, hostsByWorkshop.get(row.id) || [], quotesOf(quotesByWorkshop.get(row.id) || [], row.id)),
    ),
    error: "",
  };
}

export const loadPublicWorkshops = cache(function loadPublicWorkshops() {
  return readWorkshops(true);
});

/* Admin lists include drafts. A draft is hidden on the public site and still
   has to be selectable where an admin is looking at registrations. */
export const loadAllWorkshops = cache(function loadAllWorkshops() {
  return readWorkshops(false);
});

export const loadPublicWorkshop = cache(async function loadPublicWorkshop(slug) {
  const { workshops, error } = await loadPublicWorkshops();
  if (error) return { workshop: null, error };
  return { workshop: workshops.find((item) => item.slug === slug) || null, error: "" };
});
