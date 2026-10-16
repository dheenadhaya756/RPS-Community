import ReportClient from './ReportClient';
import ComingSoon from '../../ComingSoon';
import { reviewGate } from '@/lib/review/gate';
import '../../review.css';

export const metadata = {
  title: 'Your portfolio report — RPS Cohorts',
  robots: { index: false, follow: false },
};

/* Private: the report is read through a server action that checks the
   signed-in user owns it (see app/review/actions.js). */
export default async function ReportPage({ params }) {
  const gate = await reviewGate();
  if (!gate.open) return <ComingSoon cohort={gate.cohort} />;
  const { id } = await params;
  return <ReportClient id={id} />;
}
