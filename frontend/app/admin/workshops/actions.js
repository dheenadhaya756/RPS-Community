"use server";

import { revalidatePath } from "next/cache";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/admin";
import { removeUpload, saveUpload } from "@/lib/uploads";
import { measurePdfBytes } from "./pdfNotes";
import { formRow, pdfBytes } from "./data";
import { slugify } from "./seed";

const IMAGE_EXT = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

const IMAGE_MAX = 1 * 1024 * 1024;
const PDF_MAX = 20 * 1024 * 1024;

function validId(id) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id || ""));
}

function cleanList(value) {
  return (Array.isArray(value) ? value : []).map((item) => String(item).trim()).filter(Boolean);
}

function blank(value) {
  const text = String(value || "").trim();
  return text || null;
}

function kept(value) {
  const text = blank(value);
  if (!text || text.startsWith("blob:")) return null;
  return text;
}

function isUpload(value) {
  return Boolean(value) && typeof value === "object" && typeof value.arrayBuffer === "function" && value.size > 0;
}

async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isAdminEmail(user.email)) return null;
  return user;
}

async function storeImage(file, label) {
  if (!isUpload(file)) return { path: null };
  const ext = IMAGE_EXT[file.type];
  if (!ext) return { error: `${label} must be a JPG, PNG, WEBP, or GIF.` };
  if (file.size >= IMAGE_MAX) return { error: `${label} must be under 1 MB.` };
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const stored = await saveUpload("workshops", filename, Buffer.from(await file.arrayBuffer()));
  return { path: stored };
}

async function storePdf(file) {
  if (!isUpload(file)) return { path: null };
  if (file.type !== "application/pdf") return { error: "The notes file must be a PDF." };
  if (file.size > PDF_MAX) return { error: "The PDF must be under 20 MB." };
  const bytes = Buffer.from(await file.arrayBuffer());
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.pdf`;
  const stored = await saveUpload("resources", filename, bytes);
  const measured = measurePdfBytes(bytes);
  return {
    path: stored,
    name: file.name || filename,
    pages: measured.pages,
    sizeBytes: measured.sizeBytes,
  };
}

async function discard(paths) {
  await Promise.all(paths.filter(Boolean).map((stored) => removeUpload(stored)));
}

async function replaceLinks(admin, workshopId, hostIds, testimonials, email) {
  const { error: hostClear } = await admin.from("workshop_hosts").delete().eq("workshop_id", workshopId);
  if (hostClear) return hostClear.message;
  if (hostIds.length) {
    const { error } = await admin.from("workshop_hosts").insert(
      hostIds.map((hostId, position) => ({ workshop_id: workshopId, host_id: hostId, position })),
    );
    if (error) return error.message;
  }

  const { error: quoteClear } = await admin.from("workshop_testimonials").delete().eq("workshop_id", workshopId);
  if (quoteClear) return quoteClear.message;
  if (testimonials.length) {
    const { error } = await admin.from("workshop_testimonials").insert(
      testimonials.map((item, position) => ({
        workshop_id: workshopId,
        position,
        name: item.name,
        role: item.role,
        quote: item.quote,
        featured: item.featured,
        created_by: email,
        updated_by: email,
      })),
    );
    if (error) return error.message;
  }
  return null;
}

async function readBack(id) {
  const admin = createAdminClient();
  const { data } = await admin.from("workshops").select("*").eq("id", id).maybeSingle();
  if (!data) return null;
  const [{ data: links }, { data: quotes }] = await Promise.all([
    admin.from("workshop_hosts").select("host_id, position").eq("workshop_id", id).order("position"),
    admin.from("workshop_testimonials").select("id, name, role, quote, featured, position").eq("workshop_id", id).order("position"),
  ]);
  return formRow(data, (links || []).map((link) => link.host_id), quotes || []);
}

export async function checkWorkshopSlug(slug, id) {
  const user = await requireAdmin();
  if (!user) return { error: "You cannot change workshops." };

  const clean = slugify(slug);
  if (!clean) return { slug: "", taken: false };

  const admin = createAdminClient();
  const { data, error } = await admin.from("workshops").select("id").eq("slug", clean).maybeSingle();
  if (error) {
    console.error("slug check failed", error.message);
    return { error: "Could not check that page address." };
  }
  return { slug: clean, taken: Boolean(data && data.id !== id) };
}

export async function saveWorkshop(formData) {
  const user = await requireAdmin();
  if (!user) return { error: "You cannot change workshops." };

  let input;
  try {
    input = JSON.parse(String(formData.get("workshop") || ""));
  } catch {
    return { error: "Could not read this workshop." };
  }

  const editing = Boolean(input.id);
  if (editing && !validId(input.id)) return { error: "This workshop is not in the database yet." };

  const title = String(input.title || "").trim();
  if (title.length < 2) return { error: "Add a title before saving." };

  const slug = slugify(input.slug) || slugify(title);
  if (!slug) return { error: "Add a page address, like shortlist-ready-portfolio." };

  const status = input.status === "active" ? "active" : "draft";
  const duration = Number(input.durationMins);
  const durationMins = Number.isInteger(duration) && duration > 0 ? duration : 120;

  const admin = createAdminClient();
  const { data: slugOwner } = await admin.from("workshops").select("id").eq("slug", slug).maybeSingle();
  if (slugOwner && slugOwner.id !== input.id) return { error: "That page address is already used." };

  let existing = null;
  if (editing) {
    const { data, error } = await admin
      .from("workshops")
      .select("id, slug, banner_url, email_banner_url, notes_file_url")
      .eq("id", input.id)
      .maybeSingle();
    if (error) {
      console.error("workshop read failed", error.message);
      return { error: "Could not save this workshop." };
    }
    if (!data) return { error: "This workshop is no longer on the list." };
    existing = data;
  }

  const saved = [];
  const banner = await storeImage(formData.get("banner"), "Picture");
  if (banner.error) return { error: banner.error };
  if (banner.path) saved.push(banner.path);
  const emailBanner = await storeImage(formData.get("emailBanner"), "Small email picture");
  if (emailBanner.error) {
    await discard(saved);
    return { error: emailBanner.error };
  }
  if (emailBanner.path) saved.push(emailBanner.path);
  const notes = await storePdf(formData.get("notes"));
  if (notes.error) {
    await discard(saved);
    return { error: notes.error };
  }
  if (notes.path) saved.push(notes.path);

  const notesUrl = notes.path || kept(input.notesFileUrl);
  let notesPages = null;
  let notesSize = null;
  if (notes.path) {
    notesPages = notes.pages;
    notesSize = notes.sizeBytes;
  } else if (notesUrl) {
    const bytes = await pdfBytes(notesUrl);
    if (!bytes) {
      await discard(saved);
      return { error: "Couldn’t read that PDF, so the page count and file size were not saved." };
    }
    const measured = measurePdfBytes(bytes);
    notesPages = measured.pages;
    notesSize = measured.sizeBytes;
  }

  const hostIds = [...new Set((Array.isArray(input.hostIds) ? input.hostIds : []).filter(validId))];
  if (hostIds.length) {
    const { data: known } = await admin.from("hosts").select("id").in("id", hostIds);
    const allowed = new Set((known || []).map((host) => host.id));
    if (hostIds.some((id) => !allowed.has(id))) {
      await discard(saved);
      return { error: "One of the chosen hosts is no longer on the list." };
    }
  }

  const testimonials = (Array.isArray(input.testimonials) ? input.testimonials : [])
    .map((item) => ({
      name: blank(item.name),
      role: blank(item.role),
      quote: blank(item.quote),
      featured: !!item.featured,
    }))
    .filter((item) => item.name || item.role || item.quote);

  const row = {
    status,
    cohort_label: blank(input.cohortLabel),
    slug,
    title,
    summary: blank(input.summary),
    pitch: blank(input.pitch),
    description: cleanList(input.description),
    who_its_for: cleanList(input.whoItsFor),
    curriculum_title: blank(input.curriculumTitle),
    curriculum: cleanList(input.curriculum),
    date_time: blank(input.dateTime),
    duration_mins: durationMins,
    banner_url: banner.path || kept(input.bannerUrl),
    email_banner_url: emailBanner.path || kept(input.emailBannerUrl),
    meet_link: blank(input.meetLink),
    dial_number: blank(input.dialNumber),
    dial_pin: blank(input.dialPin),
    recording_url: blank(input.recordingUrl),
    notes_title: blank(input.notesTitle),
    notes_description: blank(input.notesDescription),
    notes_file_url: notesUrl,
    notes_file_name: notesUrl ? (notes.name || blank(input.notesFileName)) : null,
    notes_pages: notesPages,
    notes_size_bytes: notesSize,
    recap: cleanList(input.recap),
    updated_by: user.email,
  };

  let id = input.id;
  if (!editing) {
    const { data, error } = await admin
      .from("workshops")
      .insert({ ...row, capacity: 45, created_by: user.email })
      .select("id")
      .single();
    if (error) {
      await discard(saved);
      console.error("workshop insert failed", error.message);
      return { error: "Could not save this workshop." };
    }
    id = data.id;
  } else {
    const { error } = await admin.from("workshops").update(row).eq("id", id);
    if (error) {
      await discard(saved);
      console.error("workshop update failed", error.message);
      return { error: "Could not save this workshop." };
    }
  }

  const linkError = await replaceLinks(admin, id, hostIds, testimonials, user.email);
  if (linkError) {
    console.error("workshop links failed", linkError);
    return { error: "The workshop was saved, but the hosts or quotes could not be saved. Open it and save again." };
  }

  await discard([
    banner.path ? existing?.banner_url : null,
    emailBanner.path ? existing?.email_banner_url : null,
    notes.path ? existing?.notes_file_url : null,
  ]);

  revalidatePath("/admin/workshops");
  revalidatePath(`/admin/workshops/${id}`);
  revalidatePath("/");
  revalidatePath("/workshops");
  revalidatePath("/workshop");
  revalidatePath("/dashboard");
  if (slug) revalidatePath(`/workshops/${slug}`);
  if (existing?.slug && existing.slug !== slug) revalidatePath(`/workshops/${existing.slug}`);
  return { ok: true, workshop: await readBack(id) };
}

export async function setWorkshopStatus(id, status) {
  const user = await requireAdmin();
  if (!user) return { error: "You cannot change workshops." };
  if (!validId(id)) return { error: "This workshop is not in the database yet." };
  if (status !== "draft" && status !== "active") return { error: "That status is not allowed." };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("workshops")
    .update({ status, updated_by: user.email })
    .eq("id", id)
    .select("id, slug, cohort_label, title")
    .maybeSingle();
  if (error) {
    console.error("workshop status failed", error.message);
    return { error: "Could not update this workshop." };
  }
  if (!data) return { error: "This workshop is no longer on the list." };

  revalidatePath("/admin/workshops");
  revalidatePath(`/admin/workshops/${id}`);
  revalidatePath("/");
  revalidatePath("/workshops");
  revalidatePath("/workshop");
  revalidatePath("/dashboard");
  if (data.slug) revalidatePath(`/workshops/${data.slug}`);
  return { ok: true, label: data.cohort_label || data.title };
}

function alreadyHappened(iso) {
  if (!iso) return false;
  const when = new Date(iso);
  return !Number.isNaN(when.getTime()) && when.getTime() < Date.now();
}

export async function removeWorkshop(id) {
  const user = await requireAdmin();
  if (!user) return { error: "You cannot change workshops." };
  if (!validId(id)) return { error: "This workshop is not in the database yet." };

  const admin = createAdminClient();
  const { data, error: readError } = await admin
    .from("workshops")
    .select("id, slug, date_time, cohort_label, title, banner_url, email_banner_url, notes_file_url")
    .eq("id", id)
    .maybeSingle();
  if (readError) {
    console.error("workshop read failed", readError.message);
    return { error: "Could not remove this workshop." };
  }
  if (!data) return { error: "This workshop is no longer on the list." };
  if (alreadyHappened(data.date_time)) {
    return { error: "A workshop that has already happened cannot be removed." };
  }

  const { error } = await admin.from("workshops").delete().eq("id", id);
  if (error) {
    console.error("workshop delete failed", error.message);
    return { error: "Could not remove this workshop." };
  }

  await discard([data.banner_url, data.email_banner_url, data.notes_file_url]);

  if (data.slug) {
    const { error: seatError } = await admin.from("workshop_seats").delete().eq("slug", data.slug);
    if (seatError) console.error("workshop seats delete failed", seatError.message);
  }

  revalidatePath("/admin/workshops");
  revalidatePath("/");
  revalidatePath("/workshops");
  revalidatePath("/workshop");
  revalidatePath("/dashboard");
  if (data.slug) revalidatePath(`/workshops/${data.slug}`);
  return { ok: true, label: data.cohort_label || data.title };
}
