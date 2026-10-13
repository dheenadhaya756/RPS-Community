import { mkdir, readFile, unlink, writeFile } from "fs/promises";
import path from "path";

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
  const dir = path.join(uploadRoot(), kind);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, filename), bytes);
  return publicUploadPath(kind, filename);
}

export async function removeUpload(storedPath) {
  const full = uploadFile(storedPath);
  if (!full) return;
  try {
    await unlink(full);
  } catch {
    // The file is already gone. The row is what matters.
  }
}

export async function readUpload(storedPath) {
  const full = uploadFile(storedPath);
  if (!full) return null;
  try {
    return await readFile(full);
  } catch {
    return null;
  }
}
