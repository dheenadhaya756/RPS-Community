import ReviewClient from './ReviewClient';
import ComingSoon from './ComingSoon';
import { reviewGate } from '@/lib/review/gate';

export const metadata = {
  title: 'Portfolio review — RPS Cohorts',
  description:
    'Paste your portfolio link and get a free review: what’s working, what isn’t, and what to fix first.',
  openGraph: {
    title: 'Portfolio review — RPS Cohorts',
    description:
      'Paste your portfolio link and get a free review: what’s working, what isn’t, and what to fix first.',
    type: 'website',
  },
};

/* Public: anyone can open the page and paste a link. Sending it needs an
   account, and that gate lives on the box (and again in the server action). */
export default async function ReviewPage({ searchParams }) {
  // Local only: /review?preview=soon shows the countdown to an admin too.
  const preview = process.env.NODE_ENV !== 'production' && (await searchParams)?.preview === 'soon';
  // Before launch: the countdown for everyone but admins.
  const gate = await reviewGate({ preview });
  if (!gate.open) return <ComingSoon cohort={gate.cohort} />;
  return <ReviewClient />;
}
