import { loadPublicWorkshop } from '@/lib/community/publicWorkshops';

/* SEO / LinkedIn sharing. The vanilla build patched the <head> from JS; here
   it's generateMetadata() on the server, with the banner as the OG image.
   A draft has no public page, so it gets no title of its own. */
export async function generateMetadata({ params }) {
  const { slug } = await params;
  const { workshop: w, error } = await loadPublicWorkshop(slug);
  if (error || !w) return { title: 'Workshop — RPS Cohorts' };
  return {
    title: `${w.title} — RPS Cohorts`,
    description: w.summary,
    openGraph: {
      title: `${w.title} — RPS Cohorts`,
      description: w.summary,
      type: 'article',
      images: w.bannerUrl ? [w.bannerUrl] : undefined,
    },
  };
}

export default function WorkshopLayout({ children }) {
  return children;
}
