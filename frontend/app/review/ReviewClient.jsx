'use client';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import SiteShell from '@/components/community/SiteShell';
import { useReveal, useSession } from '@/lib/community/hooks';
import { STEPS, BOOKING_URL, BOOK_HREF, REVIEWS_PER_DAY } from '@/lib/review/content';
import { submitPortfolio, getMyReview, resetDevTester } from './actions';
import './review.css';

/* The link someone typed before being sent to log in, so it's waiting for them
   when they come back. Deliberately NOT under the `rps.` prefix: sign-in wipes
   everything there (see lib/community/session-state.js), and carrying this one
   value across sign-in is the whole point. It is removed the moment it's used. */
const PENDING_KEY = 'rpsReviewPendingUrl';

const DEV_NO_AUTH = process.env.NODE_ENV !== 'production' && process.env.NEXT_PUBLIC_REVIEW_DEV_NO_AUTH === '1';
// One fixed object, so effects that depend on `user` don't re-run every render.
const DEV_USER_STUB = { id: 'dev' };

function readPending() {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY) || '';
    if (!raw) return null;
    // Older pages stored just the link.
    return raw.startsWith('{') ? JSON.parse(raw) : { url: raw, caseStudy: '' };
  } catch {
    return null;
  }
}
function writePending(v) {
  try {
    if (v && v.url) sessionStorage.setItem(PENDING_KEY, JSON.stringify(v));
    else sessionStorage.removeItem(PENDING_KEY);
  } catch {
    /* private mode — they'll just paste it again */
  }
}

/* The box's prompt, cycling through the places a portfolio usually lives. */
const PROMPTS = [
  'Paste your portfolio link',
  'Paste your portfolio website link',
  'Paste your Behance profile',
  'Paste your motion reel link',
  'Paste your Framer site',
  'Paste your Webflow site',
  'Paste your Figma site',
];
const PROMPT_MS = 3500;

function useRotatingPrompt(active) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setI((n) => (n + 1) % PROMPTS.length), PROMPT_MS);
    return () => clearInterval(t);
  }, [active]);
  return { text: PROMPTS[i], key: i };
}

/* ------------------------------------------------------------- the link box */
const bookProps = BOOKING_URL ? { target: '_blank', rel: 'noopener noreferrer' } : {};

/* REVIEWS_PER_DAY free reviews a day. Once today's are used, the box makes way
   for this: their latest report, and a person for anything more. */
function UsedPanel({ review, onReset }) {
  return (
    <div className="rv-box rv-used" role="status">
      <p className="rv-used-title">You’ve used today’s {REVIEWS_PER_DAY} free reviews.</p>
      <p className="rv-used-body">
        You get {REVIEWS_PER_DAY} more tomorrow — they reset at midnight. Want another look sooner, or help
        making the fixes? Book a 1:1 call with our team and we’ll go through it together.
      </p>
      <div className="rv-used-actions">
        {review?.id && (
          <Link className="btn lg go" href={'/review/report/' + review.id}>
            See my report
          </Link>
        )}
        <a className="btn ghost lg" href={BOOK_HREF} {...bookProps}>
          Book a 1:1 call
        </a>
      </div>
      {DEV_NO_AUTH && onReset && (
        <p className="rv-used-dev">
          Local testing only:{' '}
          <button type="button" className="linkish" onClick={onReset}>
            Reset for testing
          </button>{' '}
          — start over as a new pretend account. This never shows on the live site.
        </p>
      )}
    </div>
  );
}

function ReviewBox() {
  const router = useRouter();
  const session = useSession();
  // Local testing without logging in (see DEV_NO_AUTH in ./actions.js): the
  // page acts as if someone is signed in, and the server plays along.
  const user = session.user || (DEV_NO_AUTH ? DEV_USER_STUB : null);
  const loading = DEV_NO_AUTH ? false : session.loading;
  // Today's free reviews: { left, limit, latest } once known. `used` holds the
  // latest report when none are left.
  const [status, setStatus] = useState(null);
  const [used, setUsed] = useState(null);

  useEffect(() => {
    if (loading || !user) return;
    let alive = true;
    getMyReview().then((res) => {
      if (!alive || !res || res.error) return;
      setStatus(res);
      if (res.left === 0) setUsed(res.latest || {});
    });
    return () => {
      alive = false;
    };
  }, [loading, user]);

  const [url, setUrl] = useState('');
  const [caseStudy, setCaseStudy] = useState('');
  // The Behance field stays tucked away until asked for, so the page leads with one box.
  const [showCase, setShowCase] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const resumed = useRef(false);
  // Only cycles while there's nothing typed — once there's a link, it's hidden.
  const prompt = useRotatingPrompt(!url);

  const send = useCallback(async (value, extra = '') => {
    setBusy(true);
    setError('');
    const res = await submitPortfolio({ portfolioUrl: value, caseStudyUrl: extra });
    if (res.ok) {
      // The review runs on its own page, which shows progress and then the report.
      router.push('/review/report/' + res.id);
      return;
    }
    setBusy(false);
    if (res.used) {
      setUsed(res.latest || {});
      return;
    }
    if (res.needsAuth) {
      writePending({ url: value, caseStudy: extra });
      router.push('/signin?next=' + encodeURIComponent('/review'));
      return;
    }
    setError(res.error);
  }, [router]);

  /* Back from logging in with a link waiting: put it in the box and send it,
     since pressing the button is what started all this. */
  useEffect(() => {
    if (loading || !user || resumed.current) return;
    resumed.current = true;
    const pending = readPending();
    if (!pending?.url) return;
    writePending(null);
    setUrl(pending.url);
    setCaseStudy(pending.caseStudy || '');
    send(pending.url, pending.caseStudy || '');
  }, [loading, user, send]);

  const onSubmit = (e) => {
    e.preventDefault();
    const value = url.trim();
    if (!value) {
      setError('Paste a link to your portfolio.');
      return;
    }
    if (!user) {
      writePending({ url: value, caseStudy: caseStudy.trim() });
      router.push('/signin?next=' + encodeURIComponent('/review'));
      return;
    }
    send(value, caseStudy.trim());
  };

  const resetForTesting = async () => {
    await resetDevTester();
    setUsed(null);
    setStatus(null);
    setUrl('');
    setError('');
  };
  if (used) return <UsedPanel review={used} onReset={resetForTesting} />;

  return (
    <form className="rv-box" onSubmit={onSubmit} noValidate>
      <label htmlFor="rv-url" className="sr">
        Your portfolio link
      </label>
      <div className={'rv-box-row' + (error ? ' has-err' : '')}>
        {/* A real placeholder can't fade between lines, so the prompt is drawn
            over the input instead. Screen readers get the label, not the
            rotation. */}
        <div className="rv-box-input">
          <input
            id="rv-url"
            type="url"
            inputMode="url"
            autoComplete="url"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              if (error) setError('');
            }}
            aria-invalid={error ? 'true' : undefined}
            aria-describedby="rv-url-hint"
            disabled={busy}
          />
          {!url && (
            <span className="rv-prompt" aria-hidden="true" key={prompt.key}>
              {prompt.text}
            </span>
          )}
        </div>
        <button className="btn lg go" type="submit" disabled={busy}>
          {busy ? 'Starting…' : 'Review my portfolio'}
        </button>
      </div>
      <p id="rv-url-hint" className={'rv-box-hint' + (error ? ' err' : '')} aria-live="polite">
        {error ||
          (!loading && !user
            ? `Free, ${REVIEWS_PER_DAY} a day. You’ll log in first, then we’ll take it from there.`
            : status
              ? `Free and private to you · ${status.left} of ${status.limit} left today`
              : `Free, ${REVIEWS_PER_DAY} a day, and private to you.`)}
        {!error && status?.latest?.id && (
          <>
            {' · '}
            <Link href={'/review/report/' + status.latest.id}>See your last report</Link>
          </>
        )}
      </p>

      {showCase || caseStudy ? (
        <div className="rv-box-row is-extra">
          <label htmlFor="rv-case" className="sr">
            A Behance case study (optional)
          </label>
          <div className="rv-box-input">
            <input
              id="rv-case"
              type="url"
              inputMode="url"
              placeholder="Behance case study link (optional)"
              value={caseStudy}
              onChange={(e) => {
                setCaseStudy(e.target.value);
                if (error) setError('');
              }}
              disabled={busy}
            />
          </div>
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              setCaseStudy('');
              setShowCase(false);
            }}
            disabled={busy}
          >
            Remove
          </button>
        </div>
      ) : (
        <button type="button" className="linkish rv-extra-toggle" onClick={() => setShowCase(true)}>
          + Add a Behance case study (optional)
        </button>
      )}
    </form>
  );
}

/* ===================================================================== page */
export default function ReviewClient() {
  const { user } = useSession();
  useReveal([user?.id]);

  return (
    <SiteShell active="review">
      {/* ================================================== HERO */}
      <section className="rv-hero">
        <div className="wrap">
          <span className="eyebrow">Portfolio review</span>
          <h1>Get your portfolio reviewed.</h1>
          <p className="lede">
            Paste your link. We&rsquo;ll tell you what&rsquo;s working, what isn&rsquo;t, and what to
            fix first.
          </p>
          <ReviewBox />
          <Link className="btn ghost rv-sample-link" href="/review/sample">
            See a sample report
          </Link>
        </div>
      </section>

      {/* ============================================ HOW IT WORKS */}
      <section className="section">
        <div className="wrap">
          <header className="sec-head">
            <div className="main">
              <span className="eyebrow reveal">How it works</span>
              <h2 className="reveal">Three steps, that’s it.</h2>
            </div>
          </header>
          <ol className="rv-steps">
            {STEPS.map((s, i) => (
              <li key={s.title} className="card reveal">
                <span className="num">{String(i + 1).padStart(2, '0')}</span>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </li>
            ))}
          </ol>

          <div className="rv-book reveal" id="book">
            <div>
              <h3>Want a person to look at it?</h3>
              <p>Book a 1:1 portfolio review with our team and go through it together.</p>
            </div>
            <a className="btn onDark lg go" href={BOOK_HREF} {...bookProps}>
              Book a 1:1 call
            </a>
          </div>
        </div>
      </section>
    </SiteShell>
  );
}
