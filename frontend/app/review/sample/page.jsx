import Link from 'next/link';
import SiteShell from '@/components/community/SiteShell';
import { SAMPLE } from '@/lib/review/sample';
import ReportView from '../ReportView';
import ComingSoon from '../ComingSoon';
import { reviewGate } from '@/lib/review/gate';
import '../review.css';

export const metadata = {
  title: 'Sample portfolio report — RPS Cohorts',
  description:
    'What an RPS portfolio review looks like: a score out of 100, the 3 fixes that would raise it most, a note on each case study, and a 1:1 with a designer if you want help.',
};

/* Public, static: an invented portfolio's report, so people know what they'll
   get before they send their own. */
export default async function SampleReportPage() {
  const gate = await reviewGate();
  if (!gate.open) return <ComingSoon cohort={gate.cohort} />;
  return (
    <SiteShell active="review">
      <div className="wrap page-top rv-sample">
        <Link className="backlink" href="/review">
          ← Portfolio review
        </Link>

        <header className="rv-sample-head">
          <h1>Here&rsquo;s what your report looks like.</h1>
          <p className="lede">
            This is a made-up portfolio, so you can see what you&rsquo;ll get. Your report will be
            about your own work.
          </p>
        </header>

        <ReportView report={SAMPLE} />

        {/* ------------------------------------------------ sample only */}
        <section className="rv-yours" aria-labelledby="rv-yours-h">
          <h2 id="rv-yours-h">Want a report like this for your portfolio?</h2>
          <p>Paste your link and get yours in about two minutes.</p>
          <Link className="btn lg go" href="/review">
            Review my portfolio
          </Link>
        </section>
      </div>
    </SiteShell>
  );
}
