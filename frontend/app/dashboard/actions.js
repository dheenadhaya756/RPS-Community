"use server";

import { createClient } from "@/lib/supabase/server";
import { submissionSchema } from "@/lib/validation";

const ASSIGNMENT = "Design handoff that sticks";

// Server Action: create a submission for the CURRENTLY authenticated user.
// The client can only influence `link` and `note`. user_id / email / name /
// status are taken from the verified server session — never from the browser —
// so they cannot be spoofed via dev tools.
export async function submitAssignment(input) {
  const parsed = submissionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message || "Invalid input." };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { ok: false, error: "You must be signed in to submit." };
  }

  const { error } = await supabase.from("submissions").insert({
    user_id: user.id,
    // These are also re-stamped by a DB trigger as defence-in-depth.
    user_email: user.email,
    user_name: user.user_metadata?.name || null,
    assignment: ASSIGNMENT,
    link: parsed.data.link,
    note: parsed.data.note || null,
    status: "submitted",
  });

  if (error) {
    return { ok: false, error: "Could not save your submission. Please try again." };
  }
  return { ok: true };
}
