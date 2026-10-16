'use client';
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import SiteShell from '@/components/community/SiteShell';
import { CONFIG } from '@/lib/community/content';
import { LAUNCH_AT, launchLabel } from '@/lib/review/launch';
import './review.css';

/* "Something is cooking": what everyone except admins sees until portfolio
   review launches (lib/review/launch.js). A live countdown, the reviewer at
   work on a mock portfolio, and the way in — the cohort where it launches. At
   zero the page reloads into the real thing. */

const pad = (n) => String(Math.max(0, n)).padStart(2, '0');

function useCountdown(target) {
  const end = new Date(target).getTime();
  const [now, setNow] = useState(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const left = now === null ? null : Math.max(0, end - now);
  return {
    done: left === 0,
    parts:
      left === null
        ? null
        : [
            ['Days', Math.floor(left / 86400000)],
            ['Hours', Math.floor(left / 3600000) % 24],
            ['Minutes', Math.floor(left / 60000) % 60],
            ['Seconds', Math.floor(left / 1000) % 60],
          ],
  };
}

/* The reviewer at work: a mock portfolio being read, a scan line passing over
   it, notes landing beside it. Pure CSS; still under reduced motion. */
function Cooking() {
  return (
    <div className="rv-cook" aria-hidden="true">
      <div className="rv-cook-page">
        <span className="rv-cook-bar w60" />
        <span className="rv-cook-bar w40" />
        <span className="rv-cook-hero" />
        <div className="rv-cook-row">
          <span className="rv-cook-card" />
          <span className="rv-cook-card" />
          <span className="rv-cook-card" />
        </div>
        <span className="rv-cook-bar w80" />
        <span className="rv-cook-bar w50" />
        <span className="rv-cook-scan" />
      </div>
      <span className="rv-cook-note n1">Problem framing</span>
      <span className="rv-cook-note n2">Decisions &amp; trade-offs</span>
      <span className="rv-cook-note n3">Motion &amp; timing</span>
      <span className="rv-cook-score">
        <b>??</b>
        <small>/ 100</small>
      </span>
    </div>
  );
}

export default function ComingSoon({ cohort }) {
  const { done, parts } = useCountdown(LAUNCH_AT);

  // Launch moment: reload into the product.
  useEffect(() => {
    if (done) {
      const t = setTimeout(() => window.location.reload(), 1200);
      return () => clearTimeout(t);
    }
  }, [done]);

  return (
    <SiteShell active="review">
      <section className="rv-soon">
        <div className="wrap rv-soon-in">
          <div className="rv-soon-copy">
            <span className="eyebrow">New from RPS · Portfolio review</span>
            <h1>
              Something is <span className="rv-soon-hot">cooking</span>.
            </h1>
            <p className="lede">
              An AI portfolio reviewer that reads your work the way RPS designers hire — websites, Behance and
              motion reels — and tells you exactly what to fix. It launches live at {cohort?.label || 'our next cohort'}.
            </p>

            <div className="rv-soon-clock" role="timer" aria-live="off" aria-label={`Launching ${launchLabel()}`}>
              {(parts || [['Days', 0], ['Hours', 0], ['Minutes', 0], ['Seconds', 0]]).map(([label, n]) => (
                <div key={label} className="rv-soon-unit">
                  <b>{parts ? pad(n) : '--'}</b>
                  <small>{label}</small>
                </div>
              ))}
            </div>
            <p className="rv-soon-when">{done ? 'It’s live — opening now…' : `Launching ${launchLabel()}`}</p>

            <div className="cta-row rv-soon-cta">
              <Link className="btn lg go" href={cohort?.href || '/workshops'}>
                {cohort?.label ? `Join ${cohort.label}` : 'Join the next cohort'}
              </Link>
              <a className="btn ghost lg" href={CONFIG.whatsappUrl} target="_blank" rel="noopener noreferrer">
                Get notified on WhatsApp
              </a>
            </div>
            {cohort?.title && <p className="micro rv-soon-sub">{cohort.title}</p>}
          </div>

          <Cooking />
        </div>
      </section>
    </SiteShell>
  );
}
