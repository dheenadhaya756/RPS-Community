/* =============================================================================
   Where 1:1 bookings are kept.

   Supabase Storage, in a private bucket the code creates for itself — one small
   JSON file per booking. That needs no SQL to be run and survives anything the
   review engine's host does (the free Hugging Face Space resets its disk on
   restart). Only the service-role key can read or write it, and that never
   leaves the server.

   When Supabase can't be reached (local testing runs with placeholder keys),
   the review engine's own store is used instead, so the journey still works.
   Server only. Every function resolves to data or { error }; none throws.
   ============================================================================= */

import { createAdminClient } from "@/lib/supabase/server";
import { createBookingReq, listBookingsReq, patchBookingReq } from "@/lib/review/auditor";

const BUCKET = "review-bookings";
let bucketReady = false;

function admin() {
  try {
    return createAdminClient();
  } catch {
    return null;
  }
}

async function bucket() {
  const sb = admin();
  if (!sb) throw new Error("no service-role client");
  if (!bucketReady) {
    const { error } = await sb.storage.getBucket(BUCKET);
    if (error) {
      const made = await sb.storage.createBucket(BUCKET, { public: false });
      if (made.error && !/exist/i.test(made.error.message)) throw new Error(made.error.message);
    }
    bucketReady = true;
  }
  return sb.storage.from(BUCKET);
}

async function readOne(store, name) {
  const { data, error } = await store.download(name);
  if (error || !data) return null;
  try {
    return JSON.parse(await data.text());
  } catch {
    return null;
  }
}

async function writeOne(store, b) {
  const body = new Blob([JSON.stringify(b)], { type: "application/json" });
  const { error } = await store.upload(`${b.id}.json`, body, { upsert: true, contentType: "application/json" });
  if (error) throw new Error(error.message);
}

async function all() {
  const store = await bucket();
  const { data, error } = await store.list("", { limit: 1000 });
  if (error) throw new Error(error.message);
  const rows = await Promise.all(
    (data || []).filter((f) => f.name.endsWith(".json")).map((f) => readOne(store, f.name))
  );
  return rows.filter(Boolean).sort((a, b) => b.created - a.created);
}

/* ------------------------------------------------------------------ public */

export async function createBooking(input) {
  const now = Date.now() / 1000;
  const b = {
    id: crypto.randomUUID().replace(/-/g, ""),
    userId: input.user_id,
    name: input.name,
    email: input.email,
    whatsapp: input.whatsapp,
    portfolioUrl: input.portfolio_url || "",
    reportId: input.report_id || "",
    slot: input.slot,
    topic: input.topic || "",
    priceInr: input.price_inr,
    status: "NEW",
    note: "",
    created: now,
    updated: now,
  };
  try {
    await writeOne(await bucket(), b);
    return { id: b.id, status: b.status };
  } catch (e) {
    console.warn("[bookings] Supabase storage unavailable, using the engine:", e.message);
    return createBookingReq(input);
  }
}

/* Every booking, newest first — or one person's own, with userId. */
export async function listBookings(userId) {
  try {
    const rows = await all();
    return { bookings: userId ? rows.filter((r) => r.userId === userId) : rows };
  } catch (e) {
    console.warn("[bookings] Supabase storage unavailable, using the engine:", e.message);
    return listBookingsReq(userId);
  }
}

export async function updateBooking(id, patch) {
  try {
    const store = await bucket();
    const b = await readOne(store, `${id}.json`);
    if (!b) return { error: "No such booking" };
    if (patch.status !== undefined) b.status = patch.status;
    if (patch.note !== undefined) b.note = String(patch.note).slice(0, 1000);
    b.updated = Date.now() / 1000;
    await writeOne(store, b);
    return { ok: true };
  } catch (e) {
    console.warn("[bookings] Supabase storage unavailable, using the engine:", e.message);
    return patchBookingReq(id, patch);
  }
}
