/** @type {import('next').NextConfig} */

const isDev = process.env.NODE_ENV !== "production";

// Content-Security-Policy — restricts where the page may load code/data from.
// The design uses inline `style="..."` attributes throughout, so style-src needs
// 'unsafe-inline'. Next.js injects framework scripts; in production these are
// bundled from 'self'. connect-src is opened to Supabase (REST + realtime WS).
const csp = [
  "default-src 'self'",
  // 'unsafe-eval' is only needed by the dev/HMR runtime.
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
  // Workshop recordings play in place, embedded from where they're hosted.
  // Keep in step with recordingEmbed() in lib/community/workshops.js.
  "frame-src https://www.youtube.com https://www.youtube-nocookie.com https://player.vimeo.com https://drive.google.com",
  // Direct video files (a recordingUrl ending .mp4/.webm) may live on any https host.
  "media-src 'self' https:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  // Force HTTPS for 2 years (only meaningful once served over https).
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  // Block this site from being embedded in iframes (clickjacking).
  { key: "X-Frame-Options", value: "DENY" },
  // Stop browsers from MIME-sniffing responses.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Don't leak full URLs to other origins.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Disable powerful APIs the app doesn't use.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
];

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false, // hide "X-Powered-By: Next.js"
  // Pictures are refused at 1 MB in the form. The notes PDF can be 20 MB,
  // so the request has to be allowed through far enough for that check
  // to answer instead of crashing the save.
  experimental: {
    serverActions: {
      bodySizeLimit: "40mb",
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

module.exports = nextConfig;
