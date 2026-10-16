import BookClient from './BookClient';
import ComingSoon from '../ComingSoon';
import { reviewGate } from '@/lib/review/gate';
import '../review.css';

export const metadata = {
  title: 'Book a 1:1 call — RPS Cohorts',
  description: 'A 1:1 portfolio call with a designer from RPS: go through your fixes together.',
};

export default async function BookPage() {
  const gate = await reviewGate();
  if (!gate.open) return <ComingSoon cohort={gate.cohort} />;
  return <BookClient />;
}
