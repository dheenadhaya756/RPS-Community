import { z } from "zod";
// The signup form and this schema must agree on what a valid address is, so
// both defer to the same dependency-free checker.
import { isValidEmail } from "./email";

// Only http(s) links are allowed. This blocks stored-XSS vectors like
// `javascript:...` or `data:...` URLs that would otherwise become clickable.
const safeUrl = z
  .string()
  .trim()
  .min(1, "A link is required.")
  .max(2048, "That link is too long.")
  .refine((v) => {
    try {
      const u = new URL(v);
      return u.protocol === "http:" || u.protocol === "https:";
    } catch {
      return false;
    }
  }, "Enter a valid http(s) link.");

// Assignment submission — the only fields the client is trusted to send.
// Owner identity (user_id/email/name) and status are set server-side, never
// accepted from the browser.
export const submissionSchema = z.object({
  link: safeUrl,
  note: z.string().trim().max(2000, "Note is too long.").optional().default(""),
});

export const passwordSchema = z
  .string()
  .min(8, "Use at least 8 characters.")
  .max(72, "Password is too long."); // bcrypt hard limit

export const emailSchema = z.string().trim().toLowerCase().email("Enter a valid email.");

// Workshop enrolment — the "Step 2 of 2" form on the workshop page.
// Only these three fields are trusted from the browser. The owner (user_id,
// user_email) and the REGISTERED/WAITLISTED status are decided in the database
// by public.enroll_in_workshop(), never accepted from the client.
export const enrollmentSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(1, "Missing workshop.")
    .max(120)
    .regex(/^[a-z0-9-]+$/, "Missing workshop."),
  name: z.string().trim().min(2, "We need a name to put on the list.").max(120),
  email: z.string().trim().toLowerCase().email("That email doesn’t look right."),
  // Country code required — it's where the reminder and the Meet link go, and
  // a bare local number can't be dialled by whatever sends them.
  whatsapp: z
    .string()
    .trim()
    .max(32)
    .refine((v) => v.startsWith("+"), "Add your country code, like +91.")
    .refine((v) => {
      const digits = v.replace(/\D/g, "");
      return digits.length >= 9 && digits.length <= 15;
    }, "That’s not a whole number."),
});

// Portfolio review — the link box on /review. Who it belongs to comes from the
// session; the link is the only thing trusted from the browser.
export const portfolioReviewSchema = z.object({
  portfolioUrl: safeUrl,
  // Optional: one case study they add themselves, typically on Behance.
  caseStudyUrl: z.union([z.literal(""), safeUrl]).optional(),
});

// A 1:1 mentoring booking from /review/book. Same contact rules as a workshop
// seat; the slot must be one of the offered ones (checked in the action).
export const bookingSchema = z.object({
  name: enrollmentSchema.shape.name,
  email: enrollmentSchema.shape.email,
  whatsapp: enrollmentSchema.shape.whatsapp,
  portfolioUrl: z.union([z.literal(""), safeUrl]).optional(),
  reportId: z.string().regex(/^([a-f0-9]{32})?$/).optional(),
  slot: z.string().trim().min(1, "Pick a time that suits you.").max(80),
  topic: z.string().trim().max(1000, "Keep it under 1,000 characters.").optional(),
});

export const signupEmailSchema = emailSchema.refine(
  isValidEmail,
  "Enter a valid email address."
);
