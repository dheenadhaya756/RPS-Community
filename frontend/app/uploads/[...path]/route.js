import { NextResponse } from "next/server";
import { readUpload } from "@/lib/uploads";

const TYPES = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  pdf: "application/pdf",
};

/* Serves one uploaded file. The address is /uploads/mentors/name.jpg and the
   file itself sits in the upload folder, not in public/. */
export async function GET(_request, context) {
  const { path: parts } = await context.params;
  if (!Array.isArray(parts) || parts.length !== 2) {
    return new NextResponse(null, { status: 404 });
  }
  const [kind, filename] = parts;
  const ext = String(filename.split(".").pop() || "").toLowerCase();
  const type = TYPES[ext];
  if (!type) return new NextResponse(null, { status: 404 });

  const bytes = await readUpload(`/uploads/${kind}/${filename}`);
  if (!bytes) return new NextResponse(null, { status: 404 });

  return new NextResponse(bytes, {
    headers: {
      "Content-Type": type,
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
