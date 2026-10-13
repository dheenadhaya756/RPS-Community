"use server";

import { revalidatePath } from "next/cache";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/admin";
import { removeUpload, saveUpload } from "@/lib/uploads";

const PHOTO_MAX = 250 * 1024;
const PORTRAIT_MAX = 512 * 1024;

const IMAGE_EXT = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

const TABLE_MISSING = "The hosts table is not in the database yet. Save and remove will work after that table is created.";

function missingTable(error) {
  if (!error) return false;
  return error.code === "PGRST205" || /could not find the table/i.test(error.message || "");
}

function validId(id) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id || ""));
}

function blank(value) {
  const text = String(value || "").trim();
  return text || null;
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

async function storeImage(file, maxBytes, label) {
  if (!isUpload(file)) return { path: null };
  const ext = IMAGE_EXT[file.type];
  if (!ext) return { error: `${label} must be a JPG, PNG, WEBP, or GIF.` };
  if (file.size >= maxBytes) {
    return { error: `${label} must be under ${Math.round(maxBytes / 1024)} KB.` };
  }
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const stored = await saveUpload("mentors", filename, Buffer.from(await file.arrayBuffer()));
  return { path: stored };
}

async function discard(paths) {
  await Promise.all(paths.filter(Boolean).map((stored) => removeUpload(stored)));
}

export async function saveHost(formData) {
  const user = await requireAdmin();
  if (!user) return { error: "You cannot change hosts." };

  const id = String(formData.get("id") || "");
  const editing = id.length > 0;
  if (editing && !validId(id)) {
    return { error: "This host is not in the database yet." };
  }

  const name = String(formData.get("name") || "").trim();
  if (name.length < 2) return { error: "Add the host’s name." };

  const yearsText = String(formData.get("years") || "").trim();
  if (yearsText && !/^\d{1,2}$/.test(yearsText)) {
    return { error: "Years should be a number, like 13." };
  }

  const admin = createAdminClient();
  let existing = null;
  if (editing) {
    const { data, error } = await admin
      .from("hosts")
      .select("id, photo_url, portrait_url")
      .eq("id", id)
      .maybeSingle();
    if (missingTable(error)) return { error: TABLE_MISSING };
    if (error) {
      console.error("hosts read failed", error.message);
      return { error: "Could not save this host." };
    }
    if (!data) return { error: "This host is no longer on the list." };
    existing = data;
  } else {
    const { error } = await admin.from("hosts").select("id").limit(1);
    if (missingTable(error)) return { error: TABLE_MISSING };
    if (error) {
      console.error("hosts read failed", error.message);
      return { error: "Could not save this host." };
    }
  }

  const saved = [];
  const photo = await storeImage(formData.get("photo"), PHOTO_MAX, "Small photo");
  if (photo.error) return { error: photo.error };
  if (photo.path) saved.push(photo.path);
  const portrait = await storeImage(formData.get("portrait"), PORTRAIT_MAX, "Larger portrait");
  if (portrait.error) {
    await discard(saved);
    return { error: portrait.error };
  }
  if (portrait.path) saved.push(portrait.path);

  const row = {
    name,
    title: blank(formData.get("title")),
    bio: blank(formData.get("bio")),
    role: blank(formData.get("role")),
    years: yearsText ? Number(yearsText) : null,
    photo_url: photo.path || existing?.photo_url || null,
    portrait_url: portrait.path || existing?.portrait_url || null,
    updated_by: user.email,
  };

  if (!editing) {
    const { error } = await admin.from("hosts").insert({ ...row, created_by: user.email });
    if (error) {
      await discard(saved);
      if (missingTable(error)) return { error: TABLE_MISSING };
      console.error("hosts insert failed", error.message);
      return { error: "Could not save this host." };
    }
  } else {
    const { error } = await admin.from("hosts").update(row).eq("id", id);
    if (error) {
      await discard(saved);
      if (missingTable(error)) return { error: TABLE_MISSING };
      console.error("hosts update failed", error.message);
      return { error: "Could not save this host." };
    }
    await discard([
      photo.path ? existing?.photo_url : null,
      portrait.path ? existing?.portrait_url : null,
    ]);
  }

  revalidatePath("/admin/hosts");
  return { ok: true };
}

export async function removeHost(id) {
  const user = await requireAdmin();
  if (!user) return { error: "You cannot change hosts." };
  if (!validId(id)) return { error: "This host is not in the database yet." };

  const admin = createAdminClient();
  const { data, error: readError } = await admin
    .from("hosts")
    .select("photo_url, portrait_url")
    .eq("id", id)
    .maybeSingle();
  if (missingTable(readError)) return { error: TABLE_MISSING };
  if (readError) {
    console.error("hosts read failed", readError.message);
    return { error: "Could not remove this host." };
  }
  if (!data) return { error: "This host is no longer on the list." };

  const { error } = await admin.from("hosts").delete().eq("id", id);
  if (error) {
    console.error("hosts delete failed", error.message);
    return { error: "Could not remove this host." };
  }

  await discard([data.photo_url, data.portrait_url]);
  revalidatePath("/admin/hosts");
  return { ok: true };
}
