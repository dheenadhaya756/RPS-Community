'use client';
import React, { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import SiteShell from '@/components/community/SiteShell';
import Frame, { Avatar } from '@/components/community/Frame';
import { StatusChip, DayBox, QuoteCard } from '@/components/community/Bits';
import { CONFIG } from '@/lib/community/content';
import { useReveal, useSession, identityFrom, useToasts } from '@/lib/community/hooks';
import { useSeats, useSeatCount, validateDetails } from '@/lib/community/enrollment';
import {
  bySlug, hostsOf, isPast, recordingReady, recordingState, downloadResource,
  upcoming, past as pastWorkshops, featuredPast, detailQuotes, dateFull, dayShort, time, workshopUrl,
  enrollUrl, calendarUrl, paragraphs, durationLabel, initialsFrom, recordingEmbed,
} from '@/lib/community/workshops';

/* One route, two layouts, branching on derived status. Everything on this page
   is public except three actions: enrolling, watching the recording, and
   downloading a resource — each of which gates on the real Supabase session and
   sends anonymous visitors to /signin with a `next` that brings them back to
   exactly what they were doing. */

export default function Page({ workshops, loadError }) {
  return (
    <Suspense fallback={null}>
      <WorkshopDetail workshops={workshops} loadError={loadError} />
    </Suspense>
  );
}

/* One drawn icon per kind of file in the workshop kit. */
const KIT_ICON = {
  figma: (
    <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
      <path d="M7 2.5h3v5H7a2.5 2.5 0 0 1 0-5zM10 2.5h3a2.5 2.5 0 0 1 0 5h-3zM7 7.5h3v5H7a2.5 2.5 0 0 1 0-5zM13 7.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM7 12.5h3V15a2.5 2.5 0 1 1-3-2.5z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  ),
  pdf: (
    <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
      <path d="M5 2.5h6.5L15 6v11.5H5z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M11.5 2.5V6H15M7.5 10h5M7.5 12.8h5M7.5 15.4h3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  ),
  zip: (
    <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
      <path d="M2.5 5.5a1.5 1.5 0 0 1 1.5-1.5h4l1.6 2H16a1.5 1.5 0 0 1 1.5 1.5v7.5A1.5 1.5 0 0 1 16 16.5H4A1.5 1.5 0 0 1 2.5 15z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  ),
  link: (
    <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
      <path d="M8.5 11.5a3 3 0 0 0 4.2 0l2.6-2.6a3 3 0 0 0-4.2-4.2l-1 1M11.5 8.5a3 3 0 0 0-4.2 0l-2.6 2.6a3 3 0 0 0 4.2 4.2l1-1" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  ),
};

/* E.164 stops at 15 digits, so anything past that is a slip of the thumb, not
   a number. Trimmed as it's typed rather than only rejected on submit — the
   field simply stops taking digits once the number is as long as one can be. */
const MAX_PHONE_DIGITS = 15;
function capPhone(raw) {
  const s = String(raw || '');
  const plus = s.trimStart().startsWith('+');
  let digits = 0;
  let out = '';
  for (const ch of s.replace(/[^\d ]/g, '').replace(/ {2,}/g, ' ')) {
    if (ch === ' ') {
      out += ch;
      continue;
    }
    if (digits >= MAX_PHONE_DIGITS) continue;
    digits += 1;
    out += ch;
  }
  return (plus ? '+' : '') + out;
}

/* A story paragraph that opens on a short label — "The problem: …" — gets
   that label set in bold, so a long description scans as its beats rather
   than reading as one block. Anything else renders as written. */
function StoryParagraph({ text }) {
  const m = /^([A-Z][^:.!?]{2,38}):\s+/.exec(text);
  if (!m) return <p>{text}</p>;
  return (
    <p>
      <strong>{m[1]}:</strong> {text.slice(m[0].length)}
    </p>
  );
}

/* Overlapping faces for a session with several hosts, beside the count. */
function FacesRow({ list }) {
  return (
    <span className="faces">
      {list.map((x) =>
        x.photoUrl ? (
          <img key={x.id} className="face" src={x.photoUrl} alt="" loading="lazy" decoding="async" />
        ) : null
      )}
    </span>
  );
}

/* Every body section opens the same way: a small label, then its title. */
function SectionHead({ id, label, title }) {
  return (
    <header className="wsec-head">
      <span className="eyebrow">{label}</span>
      <h2 id={id}>{title}</h2>
    </header>
  );
}

function WorkshopDetail({ workshops, loadError }) {
  const params = useParams();
  const router = useRouter();
  const search = useSearchParams();
  const { user, loading } = useSession();
  const me = identityFrom(user);
  const { seats, enroll, cancel } = useSeats(user?.id);
  const { toasts, toast } = useToasts();

  const slug = String(params?.slug || '');
  const w = useMemo(() => bySlug(slug, workshops), [slug, workshops]);

  const [panelMode, setPanelMode] = useState('default'); // 'default' | 'confirm'
  const [form, setForm] = useState(null);
  const [errors, setErrors] = useState(null);
  const [raceNotice, setRaceNotice] = useState(false);
  const [delivered, setDelivered] = useState(false);
  const [saving, setSaving] = useState(false);
  // Giving up a seat is a real decision, so it asks once before it happens.
  const [confirmRelease, setConfirmRelease] = useState(false);
  const [releasing, setReleasing] = useState(false);
  // Just let a seat go: the panel says so, instead of silently reverting to the
  // pitch card a logged-out visitor sees.
  const [released, setReleased] = useState(false);
  const mine = w ? seats[w.slug] : null;
  const past = w ? isPast(w) : false;
  // Only a past workshop shows how many seats it filled.
  const seatCount = useSeatCount(past ? w.slug : null);
  const wantsEnroll = search.get('action') === 'enroll';
  const wantedRes = search.get('res');

  useReveal([slug, user?.id, panelMode, mine?.status]);

  /* Arriving with intent — from a listing CTA, or straight back from /signin. */
  useEffect(() => {
    if (!w || past || loading) return;
    if (!wantsEnroll || mine) return;
    // Registering needs an account: signed out goes to log in (or sign up)
    // first, and comes straight back here with the form open.
    if (!user) {
      goSignIn(`${workshopUrl(w)}?action=enroll`);
    } else {
      setPanelMode('confirm');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [w?.id, wantsEnroll, user?.id, loading, past]);

  /* The seat form sits in the card grid rather than a sticky sidebar, so
     arriving with intent brings it into view instead of leaving it below. */
  useEffect(() => {
    if (panelMode !== 'confirm' || !wantsEnroll) return;
    document.getElementById('seat')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [panelMode, wantsEnroll]);

  /* Arrived back from login with a file in mind — hand it over. */
  useEffect(() => {
    if (!w || !user || !wantedRes || delivered) return;
    const r = (w.resources || []).find((x) => x.id === wantedRes);
    if (r) {
      setDelivered(true);
      if (downloadResource(r)) toast(`Downloading “${r.title}”.`, 'good');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [w?.id, user?.id, wantedRes, delivered]);

  /* Kept across the login round-trip so the flow can pick up where it left off. */
  const seatsKey = w ? 'rps.seatsAtStart.' + w.slug : null;
  const rememberSeats = () => {
    try {
      if (sessionStorage.getItem(seatsKey) === null) sessionStorage.setItem(seatsKey, '');
    } catch { /* private mode */ }
  };
  const recallSeats = () => {
    try {
      const v = sessionStorage.getItem(seatsKey);
      return v === null ? null : Number(v);
    } catch { return null; }
  };
  const forgetSeats = () => {
    try { sessionStorage.removeItem(seatsKey); } catch { /* private mode */ }
  };

  /* Every gate leaves for the real sign-in page, carrying where to come back to.
     Supabase + the middleware do the rest; nothing about auth is faked here. */
  function goSignIn(next) {
    router.push('/signin?next=' + encodeURIComponent(next));
  }

  /* ------------------------------------------------------------- not found */
  if (loadError) {
    return (
      <SiteShell active="workshops">
        <div className="wrap page-top" style={{ paddingBottom: 96 }}>
          <div className="callout plain">
            <h2>Could not load the workshops.</h2>
            <p>The list did not come through. Refresh the page and try again.</p>
          </div>
        </div>
      </SiteShell>
    );
  }

  if (!w) {
    return (
      <SiteShell active="workshops">
        <div className="wrap page-top" style={{ paddingBottom: 96 }}>
          <div className="callout plain">
            <h2>This one&rsquo;s not here.</h2>
            <p>
              It may have moved, or the link may be older than the site. The listing has everything
              we&rsquo;ve run and everything that&rsquo;s coming.
            </p>
            <div className="cta-row">
              <Link className="btn go" href="/workshops">
                See workshops
              </Link>
            </div>
          </div>
        </div>
      </SiteShell>
    );
  }

  // One host keeps the single-host card and facts it always had; several get
  // the mentors strip instead (see Mentors() below).
  const hs = hostsOf(w);
  const h = hs.length === 1 ? hs[0] : null;
  const many = hs.length > 1;
  // Every name in full, on a row of its own across the facts strip.
  const mentorLine = many
    ? hs.slice(0, -1).map((x) => x.name).join(', ') + ' and ' + hs[hs.length - 1].name
    : '';
  const ready = recordingReady(w);

  /* ------------------------------------------------------------ enrolment */
  function startEnroll() {
    rememberSeats();
    if (mine) {
      toast('You’re already in. Meet link’s in My workshops.');
      return;
    }
    if (!user) {
      goSignIn(`${workshopUrl(w)}?action=enroll`);
      return;
    }
    setForm(null);
    setErrors(null);
    setReleased(false);
    setPanelMode('confirm');
  }

  async function confirmSeat(details) {
    // Marks the field red without a round trip. The same rules run again in
    // lib/validation.js on the server and once more in the database.
    const bad = validateDetails(details);
    if (bad) {
      setErrors(bad);
      setForm(details);
      return;
    }

    setSaving(true);
    // The database decides REGISTERED vs WAITLISTED, with the capacity row
    // locked — so this is the first moment anyone knows which one it is.
    const res = await enroll(w.slug, details);
    setSaving(false);

    if (!res.ok) {
      setForm(details);
      toast(res.error || 'Could not save your seat.', 'warn');
      return;
    }

    // The 150-vs-45 race: seats were open when they started, gone by confirm.
    setRaceNotice(recallSeats() !== 0 && res.status === 'WAITLISTED');
    forgetSeats();
    setErrors(null);
    setForm(null);
    setPanelMode('default');
    toast(
      res.status === 'REGISTERED' ? 'You’re in. See you Saturday.' : 'You’re on the waitlist.',
      res.status === 'REGISTERED' ? 'good' : 'warn'
    );
  }

  /* A seat is not given up by a single stray tap. The link swaps for a plain
     yes/no in place — same card, no dialog to dismiss. */
  function ReleaseControl({ label, prompt }) {
    if (!confirmRelease) {
      return (
        <button className="linkish" type="button" onClick={() => setConfirmRelease(true)}>
          {label}
        </button>
      );
    }
    return (
      <div style={{ marginTop: 4 }}>
        <p className="micro" style={{ margin: '0 0 10px' }}>{prompt}</p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button className="btn quiet" type="button" onClick={() => setConfirmRelease(false)}>
            Keep it
          </button>
          <button className="btn" type="button" onClick={releaseSeat} disabled={releasing}>
            {releasing ? 'Releasing…' : 'Yes, release it'}
          </button>
        </div>
      </div>
    );
  }

  /* ---------------------------------------------------- enrolment panel */
  function Panel() {
    if (mine && mine.status === 'REGISTERED') {
      return (
        <div className="panel is-registered">
          <span className="status-line">✓ Registered</span>
          <h4>You&rsquo;re in.</h4>
          <DayBox w={w} />
          <p style={{ fontSize: '.95rem', marginTop: 0 }}>
            {w.meetLink
              ? 'Meet link’s ready. It’s also in My workshops.'
              : 'Meet link comes the day before, by email and on WhatsApp.'}
          </p>
          {mine.whatsapp && (
            <p className="micro" style={{ marginTop: -2 }}>
              Reminder goes to {mine.whatsapp}.
            </p>
          )}
          {w.meetLink && (
            <a
              className="btn full go"
              href={w.meetLink}
              target="_blank"
              rel="noopener noreferrer"
              style={{ marginBottom: 10 }}
            >
              Join on Meet
            </a>
          )}
          {/* The seat is taken, so the useful next act is putting the session
              somewhere it will be remembered — not a second route into My
              workshops, which the account menu already carries. */}
          <a
            className="btn quiet full"
            href={calendarUrl(w)}
            target="_blank"
            rel="noopener noreferrer"
          >
            Add to calendar
          </a>
        </div>
      );
    }

    if (mine && mine.status === 'WAITLISTED') {
      return (
        <div className="panel is-waitlisted">
          {raceNotice && (
            <div className="banner" role="status">
              Someone took the last seat while you were signing in. Rude. You&rsquo;re on the
              waitlist.
            </div>
          )}
          <span className="status-line">◔ Waitlisted</span>
          <h4>You&rsquo;re on the waitlist.</h4>
          <DayBox w={w} note="If a seat frees up, you’re first" />
          <p style={{ fontSize: '.95rem', marginTop: 0 }}>
            Seats open up more than you&rsquo;d think — people&rsquo;s weeks change.
          </p>
          <Link className="btn quiet full" href="/dashboard" style={{ marginBottom: 6 }}>
            My workshops
          </Link>
          <ReleaseControl label="Leave the waitlist" prompt="Come off the waitlist? You’d go to the back of it if you change your mind." />
        </div>
      );
    }

    /* Back from login — who's coming. Name and email come pre-filled from the
       account; the WhatsApp number is the one thing we can't already know, and
       it's where the reminder and the Meet link go. */
    if (panelMode === 'confirm' && me) {
      const v = form || { name: me.name || '', email: me.email || '', whatsapp: me.phone || '+91 ' };
      const err = (k) =>
        errors && errors[k] ? (
          <div className="hint err" role="alert">
            {errors[k]}
          </div>
        ) : null;

      return (
        <div className="panel">
          <span className="kicker">Step 2 of 2</span>
          <h4>Nearly in</h4>
          <DayBox w={w} />
          <p className="micro" style={{ marginTop: -8 }}>
            Three things and we&rsquo;ll see you there.
          </p>

          <form
            noValidate
            style={{ marginTop: 16 }}
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              confirmSeat({
                name: fd.get('name'),
                email: fd.get('email'),
                whatsapp: fd.get('whatsapp'),
              });
            }}
            onInput={(e) => {
              const fd = new FormData(e.currentTarget);
              setForm({
                name: fd.get('name'),
                email: fd.get('email'),
                whatsapp: fd.get('whatsapp'),
              });
            }}
          >
            <div className="field">
              <label htmlFor="en-name">Your name</label>
              <input
                id="en-name"
                name="name"
                type="text"
                autoComplete="name"
                defaultValue={v.name}
                aria-invalid={errors?.name ? 'true' : undefined}
              />
              {err('name')}
            </div>
            <div className="field">
              <label htmlFor="en-email">Email</label>
              <input
                id="en-email"
                name="email"
                type="email"
                autoComplete="email"
                defaultValue={v.email}
                aria-invalid={errors?.email ? 'true' : undefined}
              />
              {err('email')}
            </div>
            <div className="field">
              <label htmlFor="en-wa">WhatsApp number</label>
              <input
                id="en-wa"
                name="whatsapp"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                maxLength={20}
                placeholder="+91 98765 43210"
                defaultValue={v.whatsapp}
                aria-invalid={errors?.whatsapp ? 'true' : undefined}
                onInput={(e) => {
                  // Fires before the form's own onInput, so what the parent
                  // reads back through FormData is already the capped value.
                  const capped = capPhone(e.target.value);
                  if (capped !== e.target.value) e.target.value = capped;
                }}
              />
              {err('whatsapp') || (
                <div className="hint">
                  With the country code. Reminders and the Meet link go here.
                </div>
              )}
            </div>
            <button className="btn full go" type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Confirm my seat'}
            </button>
          </form>

          <p className="micro" style={{ marginBottom: 0 }}>
            Free. Nothing else lands in your inbox.
          </p>
        </div>
      );
    }

    /* Default. The three reassurances are the pitch — they answer "is this
       going to cost me anything?" for someone still deciding. A signed-in
       member has been past all that, so letting a seat go leaves them on a
       plain card that says what just happened, not on the sales card they last
       saw while logged out. */
    const signedIn = !!user;
    return (
      <div className="panel">
        <span className="kicker">{released ? 'Seat released' : 'Take a seat'}</span>
        <DayBox w={w} />
        {released && (
          <p className="micro" style={{ marginTop: -2 }}>
            You&rsquo;re off the list for this one. The seat is yours again any time before it
            fills.
          </p>
        )}
        <button className="btn full go" type="button" onClick={startEnroll}>
          {released ? 'Take it back' : 'Grab a seat'}
        </button>
        {!signedIn && (
          <ul className="reassure">
            <li>Free. No card, no upsell at the end.</li>
            <li>Meet link and a reminder go to your WhatsApp.</li>
            <li>Recording and files afterwards, yours to keep.</li>
          </ul>
        )}
      </div>
    );
  }

  async function releaseSeat() {
    setReleasing(true);
    const res = await cancel(w.slug);
    setReleasing(false);
    if (!res.ok) {
      toast(res.error || 'Could not release your seat.', 'warn');
      return;
    }
    setConfirmRelease(false);
    setReleased(true);
    setPanelMode('default');
    setRaceNotice(false);
    toast('Seat released. Change your mind and you can take it again.');
  }

  // Upcoming pages use the last finished session's featured quotes. A past
  // page uses its own. Either one steps back one session when those are missing.
  const { quotes: quoteList, label: saidLabel } = detailQuotes(w, workshops);
  const [leadQuote, ...moreQuotes] = quoteList;

  /* ------------------------------------------------------ UPCOMING layout
     The same page a past workshop gets, so every workshop reads the same way:
     the hero with its strip of facts, then one grid of equal cards, the quotes,
     and the band at the foot. The seat panel is a card in the first row,
     beside the brief, where the sidebar used to hold it. */
  if (!past) {
    const featured = featuredPast(workshops);
    const upFacts = [
      ['Date', dayShort(w.dateTime)],
      ['Starts', time(w.dateTime)],
      ['Length', durationLabel(w)],
      ['Where', 'Google Meet'],
      h ? ['Hosted by', h.name] : null,
      many ? ['Mentors', mentorLine] : null,
    ].filter(Boolean);

    // Straight to the form when signed in, with the seat card brought into view.
    const goToSeat = () => {
      startEnroll();
      document.getElementById('seat')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    return (
      <SiteShell active="workshops" toasts={toasts}>
        <div className="wrap page-top">
          <Link className="backlink" href="/workshops">
            ← All workshops
          </Link>
          <div className="whero past">
            <div>
              <div className="whero-chips">
                <span className="eyebrow bare">{w.cohortLabel || 'Cohort'} · Coming up</span>
                {mine && <StatusChip status={mine.status} />}
              </div>
              <h1>{w.title}</h1>
              <p className="summary">{w.summary}</p>
              <dl className="wfacts" style={{ '--n': upFacts.length }}>
                {upFacts.map(([k, v]) => (
                  <div key={k} className={k === 'Mentors' ? 'wide' : undefined}>
                    <dt>{k}</dt>
                    <dd>
                      {k === 'Mentors' && <FacesRow list={hs} />}
                      {k === 'Hosted by' && h?.photoUrl && (
                        <img className="face" src={h.photoUrl} alt="" loading="lazy" decoding="async" />
                      )}
                      {v}
                    </dd>
                  </div>
                ))}
              </dl>
              {!mine && (
                <div className="cta-row">
                  <button className="btn go" type="button" onClick={goToSeat}>
                    Grab a seat
                  </button>
                </div>
              )}
            </div>
            <div className="whero-media">
              <Frame kind={w.bannerArt} src={w.bannerUrl} alt={w.title} />
            </div>
          </div>
        </div>

        <div className="wrap wpast-body">
          <div className="wgrid2">
            <section className="wcell wstory" aria-labelledby="story-h">
              <SectionHead id="story-h" label="The session" title={w.pitch || 'What we’re building'} />
              {paragraphs(w.description).map((t, k) => (
                <StoryParagraph key={k} text={t} />
              ))}
            </section>

            <section className="wseat" id="seat" aria-label="Take a seat">
              {Panel()}
            </section>

            {!!(w.curriculum || []).length && (
              <section className="wcell wcovered" aria-labelledby="covered-h">
                <SectionHead id="covered-h" label="Inside the session" title={w.curriculumTitle || 'What you’ll walk out with'} />
                <ul className="wlist">
                  {w.curriculum.map((i, k) => (
                    <li key={k}>{i}</li>
                  ))}
                </ul>
              </section>
            )}

            {!!(w.whoItsFor || []).length && (
              <section className="wcell wcovered" aria-labelledby="for-h">
                <SectionHead id="for-h" label="Who it’s for" title="This is for you if" />
                <ul className="wlist">
                  {w.whoItsFor.map((i, k) => (
                    <li key={k}>{i}</li>
                  ))}
                </ul>
              </section>
            )}

            {h && (
              <section className="wcell whost" aria-labelledby="host-h">
                <div>
                  <span className="eyebrow">Hosted by</span>
                  <div className="whost-id">
                    {h.photoUrl ? (
                      <img className="face" src={h.photoUrl} alt="" loading="lazy" decoding="async" />
                    ) : (
                      <span className="face" aria-hidden="true">{initialsFrom(h.name)}</span>
                    )}
                    <div>
                      <h2 id="host-h">{h.name}</h2>
                      <small>{h.title}</small>
                    </div>
                  </div>
                </div>
                {h.bio && <p>{h.bio}</p>}
              </section>
            )}
          </div>

          {many && Mentors()}

          {leadQuote && (
            <section className={'wsaid' + (moreQuotes.length ? '' : ' solo')} aria-labelledby="said-h">
              <figure className="wcell wquote-lead">
                <h2 id="said-h" className="eyebrow">{saidLabel}</h2>
                <blockquote>&ldquo;{leadQuote.quote}&rdquo;</blockquote>
                <figcaption>
                  <Avatar i={0} />
                  <span>
                    <b>{leadQuote.name}</b>
                    <small>{leadQuote.role}</small>
                  </span>
                </figcaption>
              </figure>
              {!!moreQuotes.length && (
                <div className="wquotes">
                  {moreQuotes.map((t, i) => (
                    <QuoteCard key={t.id} t={t} i={i + 1} />
                  ))}
                </div>
              )}
            </section>
          )}

          {/* The band at the foot, as on a past workshop: one action, then the
              last session as a single quiet row to see how these go. */}
          {featured && featured.id !== w.id && (
            <section className="wnext is-empty" aria-labelledby="last-h">
              <div className="wnext-empty">
                <div className="wnext-main">
                  <div>
                    <span className="eyebrow">Before you come</span>
                    <h2 id="last-h">See how one of these actually goes</h2>
                    <p>Every session is recorded, with the notes from the room.</p>
                  </div>
                  <a className="btn go" href={CONFIG.whatsappUrl} target="_blank" rel="noopener noreferrer">
                    Join the WhatsApp group
                  </a>
                </div>
                <Link
                  className="wnext-archive"
                  href={workshopUrl(featured) + (recordingReady(featured) ? '#recording' : '')}
                >
                  <span className="thumb" aria-hidden="true">
                    <Frame flat kind={featured.bannerArt} src={featured.bannerUrl} alt="" />
                  </span>
                  <span className="txt">
                    <small>The last one</small>
                    <b>{featured.title}</b>
                    <span className="meta">
                      {[featured.cohortLabel, `Held ${dateFull(featured.dateTime)}`]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                  <span className="go" aria-hidden="true">
                    {recordingReady(featured) ? 'Watch it →' : 'See what happened →'}
                  </span>
                </Link>
              </div>
            </section>
          )}
        </div>
      </SiteShell>
    );
  }

  /* ----------------------------------------------------------- PAST layout
     The recording leads. Someone arriving from "Past & recordings" came to
     watch, so the player is the first thing on the page — the real YouTube
     player, sitting ready rather than running, with the way on to the
     channel right under it. Then what the session was, in one strip of facts.

     Below that the page is a single grid of equal cards: two to a row, a lone
     last card running the full width, and one gap between everything. Cards
     in a row stretch to the same height, so a short column never leaves dead
     space beside a long one. On a phone it is one column in reading order. */
  const nextUp = upcoming(workshops)[0];
  // Nothing on the calendar is no reason to end on a dead stop: the archive
  // is the other thing worth exploring from here.
  const fromArchive = nextUp ? null : pastWorkshops(workshops).find((x) => x.id !== w.id) || null;
  const kit = w.resources || [];
  const hasKit = kit.length > 0;
  const curriculum = w.curriculum || [];

  // The live count when the database answers, the content file's number when
  // it doesn't — and never past capacity, which would read as an overbooked room.
  const taken = Math.min(seatCount ?? w.seededEnrollments ?? 0, w.capacity || 0);

  // No link yet is the normal few days after a session, not "not recorded":
  // the page says it's on its way until the link is pasted in.
  const coming = !ready && recordingState(w) === 'coming';
  const embed = ready ? recordingEmbed(w.recordingUrl) : null;

  const facts = [
    ['Held', dateFull(w.dateTime)],
    ['Length', durationLabel(w)],
    w.capacity && taken ? ['Seats filled', `${taken} of ${w.capacity}`] : null,
    h ? ['Hosted by', h.name] : null,
    // With the player right there, "recorded" goes without saying.
    ready ? null : ['Recording', coming ? 'On its way' : 'Not recorded'],
    many ? ['Mentors', mentorLine] : null,
  ].filter(Boolean);

  // A member who was in the room is told so — in the same words My workshops
  // uses for the same seat, so the two pages never disagree about it.
  const wasHere = mine
    ? {
        ATTENDED: ['att', 'Been there'],
        REGISTERED: ['att', 'Been there'],
        WAITLISTED: ['wait', 'You were waitlisted'],
      }[mine.status]
    : null;

  const whatsapp = (cls) => (
    <a className={cls} href={CONFIG.whatsappUrl} target="_blank" rel="noopener noreferrer">
      Join the WhatsApp group
    </a>
  );

  const headText = (
    <>
      <div className="whero-chips">
        <span className="eyebrow bare">{w.cohortLabel || 'Past cohort'} · Completed</span>
        {wasHere && <span className={'status ' + wasHere[0]}>{wasHere[1]}</span>}
        {coming && <span className="status reg">Recording on its way</span>}
      </div>
      <h1>{w.title}</h1>
      <p className="summary">{w.summary}</p>
      <dl className="wfacts" style={{ '--n': facts.length }}>
        {facts.map(([k, v]) => (
          <div key={k} className={k === 'Mentors' ? 'wide' : undefined}>
            <dt>{k}</dt>
            <dd>
              {/* The host is a person, not a data point: their face beside the name. */}
              {k === 'Mentors' && <FacesRow list={hs} />}
              {k === 'Hosted by' && h?.photoUrl && (
                <img className="face" src={h.photoUrl} alt="" loading="lazy" decoding="async" />
              )}
              {v}
            </dd>
          </div>
        ))}
      </dl>
    </>
  );

  /* No recording yet: the artwork stands in for the player beside the text,
     and the hero offers what there is — the kit, and the group that hears
     first when the recording goes up. */
  const heroActions = hasKit || coming ? (
    <div className="cta-row">
      {hasKit && <a className="btn" href="#files">Get the workshop kit</a>}
      {coming && whatsapp('btn' + (hasKit ? ' ghost' : ''))}
    </div>
  ) : null;

  return (
    <SiteShell active="workshops" toasts={toasts}>
      <div className="wrap page-top">
        <Link className="backlink" href="/workshops#past">
          ← All workshops
        </Link>
        {ready ? (
          <>
            <section className="wrec" id="recording" aria-label={`Recording: ${w.title}`}>
              {Recording()}
            </section>
            <header className="wpast-head">{headText}</header>
          </>
        ) : (
          <div className="whero past">
            <div>
              {headText}
              {heroActions}
            </div>
            <div className="whero-media">
              <Frame kind={w.bannerArt} src={w.bannerUrl} alt="" />
            </div>
          </div>
        )}
      </div>

      <div className="wrap wpast-body">
        <div className="wgrid2">
          <section className="wcell wstory" aria-labelledby="story-h">
            <SectionHead
              id="story-h"
              label="The session"
              title={w.recapHeadline || 'What this workshop was'}
            />
            {paragraphs(w.recap || w.description).map((t, k) => (
              <StoryParagraph key={k} text={t} />
            ))}
          </section>

          {!!curriculum.length && (
            <section className="wcell wcovered" aria-labelledby="covered-h">
              <SectionHead id="covered-h" label="Inside the session" title="What we covered" />
              <ul className="wlist">
                {curriculum.map((i, k) => (
                  <li key={k}>{i}</li>
                ))}
              </ul>
            </section>
          )}

          {h && (
            <section className="wcell whost" aria-labelledby="host-h">
              <div>
                <span className="eyebrow">Hosted by</span>
                <div className="whost-id">
                  {h.photoUrl ? (
                    <img className="face" src={h.photoUrl} alt="" loading="lazy" decoding="async" />
                  ) : (
                    <span className="face" aria-hidden="true">{initialsFrom(h.name)}</span>
                  )}
                  <div>
                    <h2 id="host-h">{h.name}</h2>
                    <small>{h.title}</small>
                  </div>
                </div>
              </div>
              {h.bio && <p>{h.bio}</p>}
            </section>
          )}

          {hasKit && (
            <section className="wcell wkit" id="files" aria-labelledby="kit-h">
              <SectionHead id="kit-h" label="Take it with you" title="Workshop kit" />
              <p className="wkit-lede">
                Everything from the session, ready to explore.
                {!user && ' Log in once and it’s yours.'}
              </p>
              <div className="wkit-list">{Resources()}</div>
            </section>
          )}
        </div>

        {many && Mentors()}

        {/* One quote leads; the rest stand beside it at the same height. */}
        {leadQuote && (
          <section className={'wsaid' + (moreQuotes.length ? '' : ' solo')} aria-labelledby="said-h">
            <figure className="wcell wquote-lead">
              <h2 id="said-h" className="eyebrow">{saidLabel}</h2>
              <blockquote>&ldquo;{leadQuote.quote}&rdquo;</blockquote>
              <figcaption>
                <Avatar i={0} />
                <span>
                  <b>{leadQuote.name}</b>
                  <small>{leadQuote.role}</small>
                </span>
              </figcaption>
            </figure>
            {!!moreQuotes.length && (
              <div className="wquotes">
                {moreQuotes.map((t, i) => (
                  <QuoteCard key={t.id} t={t} i={i + 1} />
                ))}
              </div>
            )}
          </section>
        )}

        <section className={'wnext' + (nextUp ? '' : ' is-empty')} id="upnext" aria-labelledby="upnext-h">
          {nextUp ? (
            <>
              <div>
                <span className="eyebrow">Up next · {dayShort(nextUp.dateTime)}</span>
                <h2 id="upnext-h">{nextUp.title}</h2>
                <p>{nextUp.summary}</p>
              </div>
              <div className="panel">
                <DayBox w={nextUp} />
                {seats[nextUp.slug] ? (
                  <Link className="btn full" href={workshopUrl(nextUp)}>
                    You&rsquo;re {seats[nextUp.slug].status === 'WAITLISTED' ? 'on the list' : 'in'} →
                  </Link>
                ) : (
                  <Link className="btn full go" href={enrollUrl(nextUp)}>
                    Grab a seat
                  </Link>
                )}
                {whatsapp('btn ghost full')}
              </div>
            </>
          ) : (
            /* Nothing scheduled: the invitation and its one action lead; one
               workshop from the archive follows as a single quiet row. */
            <div className="wnext-empty">
              <div className="wnext-main">
                <div>
                  <span className="eyebrow">Up next</span>
                  <h2 id="upnext-h">Not scheduled yet</h2>
                  <p>Every few weeks. The group chat finds out first.</p>
                </div>
                {whatsapp('btn go')}
              </div>
              {fromArchive && (
                <Link className="wnext-archive" href={workshopUrl(fromArchive)}>
                  {/* Cropped to the illustration — the title is right beside it. */}
                  <span className="thumb" aria-hidden="true">
                    <Frame flat kind={fromArchive.bannerArt} src={fromArchive.bannerUrl} alt="" />
                  </span>
                  <span className="txt">
                    <small>Meanwhile, from the archive</small>
                    <b>{fromArchive.title}</b>
                    <span className="meta">
                      {[fromArchive.cohortLabel, `Held ${dateFull(fromArchive.dateTime)}`]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                  <span className="go" aria-hidden="true">
                    {recordingReady(fromArchive) ? 'Watch it →' : 'See what happened →'}
                  </span>
                </Link>
              )}
            </div>
          )}
        </section>
      </div>
    </SiteShell>
  );

  /* Everyone running the session, as on the poster: the portrait, the name,
     the role at RPS and the years behind it. One card, full width. */
  function Mentors() {
    return (
      <section className="wcell wmentors" aria-labelledby="mentors-h">
        <SectionHead
          id="mentors-h"
          label="Meet the mentors"
          title={past ? 'Who ran the room' : 'Who you’ll learn from'}
        />
        <ul className="wmentor-list">
          {hs.map((m) => (
            <li key={m.id} className="wmentor">
              {m.portraitUrl ? (
                <img src={m.portraitUrl} alt="" loading="lazy" decoding="async" />
              ) : (
                <span className="wmentor-ph" aria-hidden="true">{initialsFrom(m.name)}</span>
              )}
              <b>{m.name}</b>
              <small>{m.role || m.title}</small>
              {m.years ? <span className="wmentor-exp">{m.years}+ yrs exp</span> : null}
            </li>
          ))}
        </ul>
      </section>
    );
  }

  /* The recording, open to everyone: it's public on YouTube anyway, so a
     login wall here would only send people round it. The player loads
     paused; under it, the two things you can only do on YouTube itself. */
  function Recording() {
    if (!embed) {
      // A link we can't embed still plays — in a new tab, from the thumbnail.
      return (
        <div className="wvideo">
          <a
            className="wvideo-out"
            href={w.recordingUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Play the recording — ${w.title} (opens in a new tab)`}
          >
            {w.bannerUrl && <img className="thumb" src={w.bannerUrl} alt="" />}
            <span className="play" aria-hidden="true">
              <svg width="24" height="26" viewBox="0 0 24 26">
                <path d="M4 2l17 11L4 24z" fill="#C24405" />
              </svg>
            </span>
          </a>
        </div>
      );
    }

    return (
      <>
        <div className="wvideo">
          {embed.kind === 'video' ? (
            <video src={embed.src} controls playsInline preload="metadata" />
          ) : (
            <iframe
              src={embed.src}
              title={`Recording: ${w.title}`}
              allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen"
              referrerPolicy="strict-origin-when-cross-origin"
              allowFullScreen
            />
          )}
        </div>
        {embed.provider === 'youtube' && (
          <div className="wyt">
            <span className="wyt-by">
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                <path
                  d="M23 7.2a3 3 0 0 0-2.1-2.1C19 4.6 12 4.6 12 4.6s-7 0-8.9.5A3 3 0 0 0 1 7.2 31 31 0 0 0 .5 12 31 31 0 0 0 1 16.8a3 3 0 0 0 2.1 2.1c1.9.5 8.9.5 8.9.5s7 0 8.9-.5a3 3 0 0 0 2.1-2.1 31 31 0 0 0 .5-4.8 31 31 0 0 0-.5-4.8z"
                  fill="#FF0000"
                />
                <path d="M9.8 15.1 15.6 12 9.8 8.9z" fill="#fff" />
              </svg>
              Full workshop · Rock Paper Scissors Studio on YouTube
            </span>
            <span className="wyt-acts">
              <a className="btn sm ghost" href={embed.watchUrl} target="_blank" rel="noopener noreferrer">
                Like it on YouTube
              </a>
              {CONFIG.youtubeChannelUrl && (
                <a
                  className="btn sm go"
                  href={`${CONFIG.youtubeChannelUrl}?sub_confirmation=1`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Subscribe
                </a>
              )}
            </span>
          </div>
        )}
      </>
    );
  }

  /* Each file is its own small card: what it is, a line on what's inside, and
     one full-width action. The download is what login gates, not the list —
     anyone can see what the kit holds. */
  function Resources() {
    const kinds = { figma: 'Figma file', pdf: 'PDF', zip: 'Zip archive', link: 'Links' };

    return kit.map((r) => {
      // What you're about to get, before you get it: the kind, and for files,
      // how long and how heavy — a 5 MB PDF is worth knowing on a phone plan.
      const meta = [kinds[r.type] || 'File', r.pages && `${r.pages} pages`, r.size]
        .filter(Boolean)
        .join(' · ');
      const isLink = r.type === 'link';

      return (
        <article className="wres" key={r.id}>
          <div className="wres-head">
            <span className={'wres-icon ' + (r.type || 'file')} aria-hidden="true">
              {KIT_ICON[r.type] || KIT_ICON.pdf}
            </span>
            <div>
              <h3>{r.title}</h3>
              <p>{r.description || meta}</p>
              {r.description && <small>{meta}</small>}
            </div>
          </div>
          <button
            className="btn quiet full sm"
            type="button"
            aria-label={`${isLink ? 'View' : 'Download'} ${r.title}`}
            onClick={() => {
              if (!user) {
                // Remember which file they wanted; hand it over on the way back.
                goSignIn(`${workshopUrl(w)}?res=${encodeURIComponent(r.id)}#files`);
                return;
              }
              if (downloadResource(r)) toast(`${isLink ? 'Opening' : 'Downloading'} “${r.title}”.`, 'good');
              else toast('That file isn’t up yet — try again shortly.', 'bad');
            }}
          >
            {isLink ? (user ? 'View all' : 'Log in to view') : user ? 'Download' : 'Log in to download'}
          </button>
        </article>
      );
    });
  }
}
