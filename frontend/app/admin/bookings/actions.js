"use server";

import { revalidatePath } from "next/cache";
import { bookingsAccess } from "@/lib/review/bookings-gate";
import { patchBookingReq } from "@/lib/review/auditor";

const STATUSES = ["NEW", "CONFIRMED", "PAID", "DONE", "CANCELLED"];

/* The admin check runs here as well as on the page: a Server Action is a POST
   endpoint anyone can call once they know its name. */
async function allowed() {
  return (await bookingsAccess()).allowed;
}

export async function setBookingStatus(id, status) {
  if (!(await allowed())) return { ok: false, error: "Not allowed." };
  if (!/^[a-f0-9]{32}$/.test(String(id || ""))) return { ok: false, error: "Missing booking." };
  if (!STATUSES.includes(status)) return { ok: false, error: "Unknown status." };
  const res = await patchBookingReq(id, { status });
  if (res.error) return { ok: false, error: res.error };
  revalidatePath("/admin/bookings");
  return { ok: true };
}

export async function setBookingNote(id, note) {
  if (!(await allowed())) return { ok: false, error: "Not allowed." };
  if (!/^[a-f0-9]{32}$/.test(String(id || ""))) return { ok: false, error: "Missing booking." };
  const res = await patchBookingReq(id, { note: String(note || "").slice(0, 1000) });
  if (res.error) return { ok: false, error: res.error };
  return { ok: true };
}
