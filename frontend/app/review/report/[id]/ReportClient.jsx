'use client';
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import SiteShell from '@/components/community/SiteShell';
import { PROGRESS } from '@/lib/review/content';
import { CONFIG } from '@/lib/community/content';
import { getReview } from '../../actions';
import ReportView from '../../ReportView';

const POLL_MS = 2500;

const bare = (url) => String(url || '').replace(/^https?:\/\//, '').replace(/\/$/, '');

/* A review takes a minute or two. Until it's done, the page lists the stages
   with the current one marked; the engine says which stage it's on. */
function Progress({ job }) {
  const at = PROGRESS.findIndex((p) => p.id === job?.stage);
  return (
    <div className="rv-progress" role="status" aria-live="polite">
      <ol>
        {PROGRESS.map((p, i) => (
          <li key={p.id} className={i < at ? 'is-done' : i === at ? 'is-now' : ''}>
            <i aria-hidden="true" />
            <span>
              {p.label}
              {i < at && <span className="sr"> (done)</span>}
            </span>
          </li>
        ))}
      </ol>
      <p className="rv-progress-foot">
        {job?.stage === 'queued'
          ? 'Someone else’s review is just finishing. Yours starts in a moment.'
          : 'This usually takes about two minutes. You can leave this page open.'}
      </p>
    </div>
  );
}

/* "Download PDF": the browser's own Save as PDF, with a print layout that
   keeps the report and drops the site around it (see review.css). The page
   title becomes the file name the browser suggests. */
function downloadPdf(site) {
  const before = document.title;
  document.title = `RPS portfolio report — ${site || 'portfolio'}`;
  const restore = () => {
    document.title = before;
    window.removeEventListener('afterprint', restore);
  };
  window.addEventListener('afterprint', restore);
  window.print();
}

export default function ReportClient({ id }) {
  const [job, setJob] = useState(null);

  useEffect(() => {
    let alive = true;
    let timer;
    const tick = async () => {
      const res = await getReview(id);
      if (!alive) return;
      setJob(res);
      // Keep asking while it runs, and through a blip where the engine can't be reached.
      const keepGoing = res.status === 'queued' || res.status === 'running' || (!res.status && res.error);
      if (keepGoing) timer = setTimeout(tick, POLL_MS);
    };
    tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [id]);

  const site = bare(job?.report?.site || job?.url);
  let head;
  let body = null;

  if (!job) {
    head = { h1: 'Getting your review…' };
    body = <Progress job={null} />;
  } else if (job.needsAuth) {
    head = { h1: 'Log in to see this report.', lede: 'Reports are private to the account that asked for them.' };
    body = (
      <Link className="btn lg go" href={'/signin?next=' + encodeURIComponent(`/review/report/${id}`)}>
        Log in
      </Link>
    );
  } else if (job.notFound) {
    head = {
      h1: 'We can’t find that report.',
      lede: 'It may belong to a different account, or the link is incomplete.',
    };
    body = (
      <Link className="btn lg go" href="/review">
        Review a portfolio
      </Link>
    );
  } else if (job.status === 'failed') {
    head = { h1: 'We couldn’t finish this review.', lede: job.error };
    body = (
      <Link className="btn lg go" href="/review">
        Try again
      </Link>
    );
  } else if (job.status === 'done' && job.report) {
    head = {
      h1: 'Here’s your portfolio report.',
      lede: (
        <>
          How <b>{site}</b> reads to a hiring manager, and what to fix first.
        </>
      ),
    };
    body = (
      <>
        <div className="rv-report-actions">
          <button type="button" className="btn" onClick={() => downloadPdf(site)}>
            Download PDF
          </button>
          <span className="rv-report-tip">Choose “Save as PDF” in the window that opens.</span>
        </div>
        <ReportView report={job.report} id={id} />
      </>
    );
  } else {
    head = {
      h1: 'Reviewing your portfolio…',
      lede: site ? (
        <>
          We&rsquo;re going through <b>{site}</b> the way a hiring manager would.
        </>
      ) : null,
    };
    body = (
      <>
        <Progress job={job} />
        {job.error && <p className="rv-box-hint err">{job.error}</p>}
      </>
    );
  }

  return (
    <SiteShell active="review">
      <div className="wrap page-top rv-sample">
        {/* The A4 report's own header and footer — only on paper / in the PDF. */}
        {job?.status === 'done' && job.report && (
          <>
            <div className="rv-print-head" aria-hidden="true">
              <img src={CONFIG.logoUrl} alt="" />
              <div>
                <b>RPS portfolio review</b>
                <span>
                  {site} · reviewed {job.report.reviewedOn}
                </span>
              </div>
            </div>
          </>
        )}
        <Link className="backlink" href="/review">
          ← Portfolio review
        </Link>
        <header className="rv-sample-head">
          <h1>{head.h1}</h1>
          {head.lede && <p className="lede">{head.lede}</p>}
        </header>
        {body}
      </div>
    </SiteShell>
  );
}
