import { mkdir, readFile, unlink, writeFile } from "fs/promises";
import path from "path";
import { createAdminClient } from "@/lib/supabase/server";

/* Where uploads live: a private Supabase Storage bucket when the service-role
   key is set (Vercel keeps no files between requests, so a folder on disk
   would lose them), otherwise the folder below. The web path stored in the
   database is the same either way: /uploads/<kind>/<file>. */
const BUCKET = "uploads";
let bucketReady = false;

async function bucket() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  try {
    const sb = createAdminClient();
    if (!bucketReady) {
      const { error } = await sb.storage.getBucket(BUCKET);
      if (error) {
        const made = await sb.storage.createBucket(BUCKET, { public: false });
        if (made.error && !/exist/i.test(made.error.message)) throw new Error(made.error.message);
      }
      bucketReady = true;
    }
    return sb.storage.from(BUCKET);
  } catch (e) {
    console.warn("[uploads] Supabase storage unavailable, using the folder:", e.message);
    return null;
  }
}

const TYPES = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", pdf: "application/pdf" };
const keyOf = (storedPath) => {
  const m = /^\/uploads\/(mentors|workshops|resources)\/([^/]+)$/.exec(String(storedPath || ""));
  return m && FILE_NAME.test(m[2]) ? `${m[1]}/${m[2]}` : null;
};

/* Files an admin uploads. They do not live in public/, because a deploy
   replaces that folder and the pictures would go with it.

   On this machine the folder is frontend/uploads (not in git). On the VPS set
   UPLOAD_DIR to an absolute path outside the project, such as
   /var/lib/rps/uploads, so a deploy never touches it.

   Three directories, one job each:
     mentors    host pictures
     workshops  workshop pictures
     resources  PDFs
   The database stores the web path, /uploads/mentors/123-ab12cd.jpg. */

const KINDS = new Set(["mentors", "workshops", "resources"]);
const FILE_NAME = /^[a-z0-9][a-z0-9._-]{0,120}$/i;

export function uploadRoot() {
  const set = String(process.env.UPLOAD_DIR || "").trim();
  if (set) return path.resolve(set);
  return path.join(process.cwd(), "uploads");
}

export function publicUploadPath(kind, filename) {
  return `/uploads/${kind}/${filename}`;
}

/* A stored path is safe to read or delete only when it is one file inside
   one of the three directories. Anything else, including the portraits that
   shipped in public/assets/mentors, is left alone. */
export function uploadFile(storedPath) {
  const match = /^\/uploads\/(mentors|workshops|resources)\/([^/]+)$/.exec(String(storedPath || ""));
  if (!match || !KINDS.has(match[1]) || !FILE_NAME.test(match[2])) return null;
  const dir = path.resolve(uploadRoot(), match[1]);
  const full = path.resolve(dir, match[2]);
  if (full !== path.join(dir, match[2])) return null;
  return full;
}

export async function saveUpload(kind, filename, bytes) {
  if (!KINDS.has(kind) || !FILE_NAME.test(filename)) {
    throw new Error("That file cannot be stored.");
  }
  const store = await bucket();
  if (store) {
    const ext = String(filename.split(".").pop() || "").toLowerCase();
    const { error } = await store.upload(`${kind}/${filename}`, bytes, {
      upsert: true,
      contentType: TYPES[ext] || "application/octet-stream",
    });
    if (error) throw new Error("That file could not be stored: " + error.message);
    return publicUploadPath(kind, filename);
  }
  const dir = path.join(uploadRoot(), kind);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, filename), bytes);
  return publicUploadPath(kind, filename);
}

export async function removeUpload(storedPath) {
  const key = keyOf(storedPath);
  const store = key ? await bucket() : null;
  if (store) await store.remove([key]).catch(() => {});
  const full = uploadFile(storedPath);
  if (!full) return;
  try {
    await unlink(full);
  } catch {
    // The file is already gone. The row is what matters.
  }
}

export async function readUpload(storedPath) {
  const key = keyOf(storedPath);
  const store = key ? await bucket() : null;
  if (store) {
    const { data } = await store.download(key);
    if (data) return Buffer.from(await data.arrayBuffer());
  }
  const full = uploadFile(storedPath);
  if (!full) return null;
  try {
    return await readFile(full);
  } catch {
    return null;
  }
}
