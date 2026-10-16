/* =============================================================================
   Where finished reports live: Supabase Storage, not the review engine.

   The engine is a worker — it opens the portfolio, asks Gemini, and holds the
   result only until the site collects it. The first time a finished report is
   read, it is copied here with its screenshots:

     review-reports/<id>/report.json   { userId, url, report, created }
     review-reports/<id>/shots/<n>.jpg

   From then on it is read from here, so a report outlives any restart or
   redeploy of the engine. The bucket is private and created by the code; only
   the service-role key (server only) touches it. When Supabase can't be
   reached (local testing with placeholder keys), callers fall back to the
   engine. Server only; nothing here throws.
   ============================================================================= */

import { createAdminClient } from "@/lib/supabase/server";
import { readShot } from "@/lib/review/auditor";

const BUCKET = "review-reports";
let ready = false;

async function store() {
  let sb;
  try {
    sb = createAdminClient();
  } catch {
    return null;
  }
  try {
    if (!ready) {
      const { error } = await sb.storage.getBucket(BUCKET);
      if (error) {
        const made = await sb.storage.createBucket(BUCKET, { public: false });
        if (made.error && !/exist/i.test(made.error.message)) throw new Error(made.error.message);
      }
      ready = true;
    }
    return sb.storage.from(BUCKET);
  } catch (e) {
    console.warn("[reports] Supabase storage unavailable:", e.message);
    return null;
  }
}

/* A saved report this user owns, shaped like the engine's job — or null. */
export async function loadSavedReport(id, userId) {
  const s = await store();
  if (!s) return null;
  try {
    const { data, error } = await s.download(`${id}/report.json`);
    if (error || !data) return null;
    const saved = JSON.parse(await data.text());
    if (saved.userId !== userId) return { notFound: true };
    return { id, url: saved.url, status: "done", stage: "done", report: saved.report, error: null, saved: true };
  } catch {
    return null;
  }
}

/* Copy a finished report and its screenshots out of the engine. Best effort:
   if it fails, the report still shows (from the engine) and saving is tried
   again on the next read. */
export async function saveReport(id, userId, job) {
  const s = await store();
  if (!s || job?.status !== "done" || !job.report) return false;
  try {
    for (const shot of job.report.shots || []) {
      const res = await readShot(id, shot.n, userId);
      if (!res) continue;
      const bytes = new Uint8Array(await res.arrayBuffer());
      await s.upload(`${id}/shots/${shot.n}.jpg`, bytes, { upsert: true, contentType: "image/jpeg" });
    }
    const body = JSON.stringify({ userId, url: job.url, report: job.report, created: Date.now() / 1000 });
    const { error } = await s.upload(`${id}/report.json`, new Blob([body], { type: "application/json" }), {
      upsert: true,
      contentType: "application/json",
    });
    if (error) throw new Error(error.message);
    return true;
  } catch (e) {
    console.warn(`[reports] Could not save report ${id}:`, e.message);
    return false;
  }
}

/* One saved screenshot, as bytes — or null. Ownership is checked by the
   caller through loadSavedReport. */
export async function loadSavedShot(id, n) {
  const s = await store();
  if (!s) return null;
  try {
    const { data, error } = await s.download(`${id}/shots/${n}.jpg`);
    if (error || !data) return null;
    return new Uint8Array(await data.arrayBuffer());
  } catch {
    return null;
  }
}
