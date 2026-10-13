import path from "path";
import { readFile } from "fs/promises";
import { createAdminClient } from "@/lib/supabase/server";
import { readUpload } from "@/lib/uploads";
import { formatSize } from "./pdfNotes";

function lines(value) {
  const list = Array.isArray(value) ? value.map((v) => String(v)) : [];
  return list.length ? list : [""];
}

function indiaIso(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:00+05:30`;
}

export function listRow(row) {
  return {
    id: row.id,
    slug: row.slug || "",
    status: row.status || "draft",
    cohortLabel: row.cohort_label || "",
    title: row.title || "",
    summary: row.summary || "",
    pitch: row.pitch || "",
    dateTime: row.date_time || "",
  };
}

export function formRow(row, hostIds, testimonials) {
  return {
    id: row.id,
    slug: row.slug || "",
    status: row.status || "draft",
    cohortLabel: row.cohort_label || "",
    title: row.title || "",
    summary: row.summary || "",
    pitch: row.pitch || "",
    description: lines(row.description),
    whoItsFor: lines(row.who_its_for),
    curriculumTitle: row.curriculum_title || "",
    curriculum: lines(row.curriculum),
    dateTime: indiaIso(row.date_time),
    durationMins: row.duration_mins ?? 120,
    bannerUrl: row.banner_url || "",
    emailBannerUrl: row.email_banner_url || "",
    hostIds,
    meetLink: row.meet_link || "",
    dialNumber: row.dial_number || "",
    dialPin: row.dial_pin || "",
    recordingUrl: row.recording_url || "",
    notesTitle: row.notes_title || "",
    notesDescription: row.notes_description || "",
    notesFileName: row.notes_file_name || "",
    notesFileUrl: row.notes_file_url || "",
    notesPages: row.notes_pages == null ? "" : String(row.notes_pages),
    notesSize: row.notes_size_bytes == null ? "" : formatSize(Number(row.notes_size_bytes)),
    recap: lines(row.recap),
    testimonials: testimonials.map((item) => ({
      id: item.id,
      name: item.name || "",
      role: item.role || "",
      quote: item.quote || "",
      featured: !!item.featured,
    })),
  };
}

export async function listHostOptions() {
  const admin = createAdminClient();
  const { data, error } = await admin.from("hosts").select("id, name, role").order("name");
  if (error) {
    console.error("hosts list failed", error.message);
    return [];
  }
  return (data || []).map((host) => ({ id: host.id, name: host.name || "", role: host.role || "" }));
}

export async function listWorkshops() {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("workshops")
    .select("id, slug, status, cohort_label, title, summary, pitch, date_time")
    .order("date_time", { ascending: false, nullsFirst: false });
  if (error) {
    console.error("workshops list failed", error.message);
    return { rows: [], error: "Could not load the workshops." };
  }
  return { rows: (data || []).map(listRow), error: "" };
}

export async function loadWorkshop(id) {
  const admin = createAdminClient();
  const { data, error } = await admin.from("workshops").select("*").eq("id", id).maybeSingle();
  if (error || !data) {
    if (error) console.error("workshop read failed", error.message);
    return null;
  }
  const [{ data: links }, { data: quotes }] = await Promise.all([
    admin.from("workshop_hosts").select("host_id, position").eq("workshop_id", id).order("position"),
    admin.from("workshop_testimonials").select("id, name, role, quote, featured, position").eq("workshop_id", id).order("position"),
  ]);
  return formRow(
    data,
    (links || []).map((link) => link.host_id),
    quotes || [],
  );
}

export async function pdfBytes(storedPath) {
  const stored = String(storedPath || "");
  if (stored.startsWith("/uploads/")) return readUpload(stored);
  if (!stored.startsWith("/assets/") || stored.includes("..")) return null;
  try {
    return await readFile(path.join(process.cwd(), "public", stored));
  } catch {
    return null;
  }
}
