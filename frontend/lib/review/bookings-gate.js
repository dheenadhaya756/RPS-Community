import { isAdminEmail } from "@/lib/admin";
import { signedInUser } from "@/lib/review/viewer";

/* Who may see and work the 1:1 bookings: an admin from the allow-list, or the
   pretend tester in local testing (`npm run dev` with REVIEW_DEV_NO_AUTH=1).
   Returns { user, allowed }. Server only. */
export async function bookingsAccess() {
  const { user } = await signedInUser();
  return { user, allowed: !!user && (user.isDev || isAdminEmail(user.email)) };
}
