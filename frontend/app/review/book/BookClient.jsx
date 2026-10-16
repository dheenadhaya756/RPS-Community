'use client';
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import SiteShell from '@/components/community/SiteShell';
import { useSession } from '@/lib/community/hooks';
import { validateDetails } from '@/lib/community/enrollment';
import { MENTORING_PRICE_INR, SLOTS } from '@/lib/review/content';
import { WHAT_YOU_GET } from '../Guidance';
import { createBooking, getBookingPrefill } from '../actions';

/* Local testing without logging in — the same switch as /review. */
const DEV_NO_AUTH =
  process.env.NODE_ENV !== 'production' && process.env.NEXT_PUBLIC_REVIEW_DEV_NO_AUTH === '1';

/* How a booking goes, from this form to the call. */
const HOW = [
  'Send this request — it takes a minute.',
  'We message you on WhatsApp within a day to fix the exact time.',
  `Pay ₹${MENTORING_PRICE_INR} through the link we send. Your slot is held once it’s paid.`,
  'Meet your mentor on Google Meet and go through your portfolio together.',
];

const rupees = (n) => '₹' + Number(n).toLocaleString('en-IN');

function Field({ id, label, error, hint, children }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {error ? (
        <div className="hint err" role="alert">
          {error}
        </div>
      ) : hint ? (
        <div className="hint">{hint}</div>
      ) : null}
    </div>
  );
}

export default function BookClient() {
  const router = useRouter();
  const session = useSession();
  const signedIn = !!session.user || DEV_NO_AUTH;
  const loading = DEV_NO_AUTH ? false : session.loading;

  const [prefill, setPrefill] = useState(null);
  const [form, setForm] = useState({
    name: '',
    email: '',
    whatsapp: '+91 ',
    portfolioUrl: '',
    slot: '',
    topic: '',
  });
  const [errors, setErrors] = useState({});
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(null);

  // Fill in what we already know: the account, and the portfolio they had reviewed.
  useEffect(() => {
    if (loading || !signedIn) return;
    let alive = true;
    getBookingPrefill().then((p) => {
      if (!alive || !p?.signedIn) return;
      setPrefill(p);
      setForm((f) => ({
        ...f,
        name: f.name || p.name || '',
        email: f.email || p.email || '',
        portfolioUrl: f.portfolioUrl || p.portfolioUrl || '',
      }));
    });
    return () => {
      alive = false;
    };
  }, [loading, signedIn]);

  const set = (k) => (e) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    if (errors[k]) setErrors((x) => ({ ...x, [k]: '' }));
  };

  async function submit(e) {
    e.preventDefault();
    setProblem('');
    if (!signedIn) {
      router.push('/signin?next=' + encodeURIComponent('/review/book'));
      return;
    }
    // Same contact checks as a workshop seat, without the round trip.
    const bad = { ...(validateDetails(form) || {}) };
    if (!form.slot) bad.slot = 'Pick a time that suits you.';
    if (Object.keys(bad).length) {
      setErrors(bad);
      return;
    }
    setBusy(true);
    const res = await createBooking({ ...form, reportId: prefill?.reportId || '' });
    setBusy(false);
    if (res.needsAuth) {
      router.push('/signin?next=' + encodeURIComponent('/review/book'));
      return;
    }
    if (!res.ok) {
      if (res.field) setErrors({ [res.field]: res.error });
      else setProblem(res.error);
      return;
    }
    setSent({ slot: form.slot, whatsapp: form.whatsapp });
  }

  /* ----------------------------------------------------------- the panel */
  let panel;
  if (sent || prefill?.open) {
    const b = sent || prefill.open;
    panel = (
      <div className="panel is-registered rv-bk-done" role="status">
        <span className="status-line">✓ Request received</span>
        <h4>We&rsquo;ll be in touch.</h4>
        <p>
          We&rsquo;ll message you on WhatsApp{sent?.whatsapp ? <> at <b>{sent.whatsapp}</b></> : null} within a
          day to confirm your time{b.slot ? <> — {b.slot.toLowerCase()} —</> : null} and send the {rupees(MENTORING_PRICE_INR)}{' '}
          payment link.
        </p>
        <div className="rv-bk-actions">
          <Link className="btn quiet" href="/review">
            Back to portfolio review
          </Link>
        </div>
      </div>
    );
  } else {
    panel = (
      <form className="panel rv-bk-form" onSubmit={submit} noValidate>
        <span className="kicker">Your details</span>
        <div className="rv-bk-grid">
          <Field id="bk-name" label="Your name" error={errors.name}>
            <input id="bk-name" autoComplete="name" value={form.name} onChange={set('name')} aria-invalid={errors.name ? 'true' : undefined} />
          </Field>
          <Field id="bk-email" label="Email" error={errors.email}>
            <input id="bk-email" type="email" autoComplete="email" value={form.email} onChange={set('email')} aria-invalid={errors.email ? 'true' : undefined} />
          </Field>
          <Field id="bk-wa" label="WhatsApp number" error={errors.whatsapp} hint="With the country code. We confirm the time here.">
            <input id="bk-wa" type="tel" inputMode="tel" autoComplete="tel" value={form.whatsapp} onChange={set('whatsapp')} aria-invalid={errors.whatsapp ? 'true' : undefined} />
          </Field>
          <Field id="bk-slot" label="When suits you" error={errors.slot}>
            <select id="bk-slot" value={form.slot} onChange={set('slot')} aria-invalid={errors.slot ? 'true' : undefined}>
              <option value="">Choose a time</option>
              {SLOTS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field id="bk-url" label="Your portfolio" error={errors.portfolioUrl} hint="The site you want to go through.">
          <input id="bk-url" type="url" inputMode="url" placeholder="yourname.com" value={form.portfolioUrl} onChange={set('portfolioUrl')} />
        </Field>
        <Field id="bk-topic" label="What do you want help with? (optional)" error={errors.topic}>
          <textarea id="bk-topic" placeholder="e.g. My case studies don’t show my decisions, and I’m applying for product design roles." value={form.topic} onChange={set('topic')} />
        </Field>
        {problem && (
          <div className="hint err" role="alert">
            {problem}
          </div>
        )}
        <div className="rv-bk-submit">
          <button className="btn go" type="submit" disabled={busy}>
            {busy ? 'Sending…' : signedIn ? `Request a call · ${rupees(MENTORING_PRICE_INR)}` : 'Log in to book'}
          </button>
          <span className="micro">You only pay once we&rsquo;ve confirmed a time.</span>
        </div>
      </form>
    );
  }

  return (
    <SiteShell active="review">
      <div className="wrap page-top rv-bk">
        <Link className="backlink" href="/review">
          ← Portfolio review
        </Link>

        <header className="rv-bk-head">
          <span className="eyebrow">1:1 mentoring</span>
          <h1>Book a 1:1 call with an RPS designer.</h1>
          <p className="lede">
            Your report shows what to fix. On a call, a designer from our team goes through your portfolio with you
            and helps you make the changes.
          </p>
        </header>

        <div className="rv-bk-layout">
          {panel}

          <aside className="rv-bk-side" aria-label="What you get">
            <div className="rv-bk-price">
              <b>{rupees(MENTORING_PRICE_INR)}</b>
              <span>one 1:1 call · Google Meet</span>
            </div>
            <h3>On the call</h3>
            <ul className="rv-bk-list">
              {WHAT_YOU_GET.map((w) => (
                <li key={w}>
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M3 8.5l3.2 3L13 4.5" />
                  </svg>
                  {w}
                </li>
              ))}
            </ul>
            <h3>How it works</h3>
            <ol className="rv-bk-steps">
              {HOW.map((h, i) => (
                <li key={h}>
                  <span className="num">{String(i + 1).padStart(2, '0')}</span>
                  <span>{h}</span>
                </li>
              ))}
            </ol>
          </aside>
        </div>
      </div>
    </SiteShell>
  );
}
