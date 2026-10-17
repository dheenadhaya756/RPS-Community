/* Where to send someone after they log in: only a page on this site.
   Anything else (another host, "//host", "/\host", "@host", a scheme, control
   characters) falls back, so a link like /signin?next=https://evil.example
   can't bounce a person off the site. Safe on the client and the server. */

const BASE = "https://rps.invalid";

export function safeNext(raw, fallback = "/dashboard") {
  const wanted = String(raw || "");
  if (!wanted.startsWith("/") || wanted.startsWith("//") || wanted.includes("\\")) return fallback;
  if (/[\u0000-\u001f\u007f]/.test(wanted)) return fallback;
  try {
    const u = new URL(wanted, BASE);
    if (u.origin !== BASE) return fallback;
    return u.pathname + u.search + u.hash;
  } catch {
    return fallback;
  }
}
