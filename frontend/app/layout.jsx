import "./globals.css";

const FAVICON =
  "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='8' fill='%23FF630B'/><path d='M9 22V10h7a4 4 0 0 1 0 8h-3l5 4' stroke='white' stroke-width='2.6' fill='none' stroke-linecap='round' stroke-linejoin='round'/></svg>";

export const metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL || "https://cohorts.rockpaperscissors.studio"
  ),
  title: "RPS Cohorts — free live design workshops",
  description:
    "Free live design workshops. We build real client work in front of you, you build along.",
  icons: { icon: FAVICON },
  openGraph: {
    title: "RPS Cohorts — free live design workshops",
    description:
      "Free live design workshops. We build real client work in front of you, you build along.",
    type: "website",
  },
};

export const viewport = {
  themeColor: "#13100E",
};

// Render on request, not at build time. These pages are auth-driven and use the
// Supabase client at runtime, so there's nothing to gain from static prerender —
// and prerendering would try to build a Supabase client before env vars exist.
export const dynamic = "force-dynamic";

// The site is dark only, exactly as the design ships it. The light palette is
// still in community.css and every component names a token rather than a
// colour, so re-enabling the switch is a matter of restoring the stored/system
// lookup and putting the toggle back in the nav.
export default function RootLayout({ children }) {
  return (
    <html lang="en" data-theme="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
