'use client';
import React from 'react';
import Link from 'next/link';
import SiteShell from '@/components/community/SiteShell';
import { useReveal, useSession } from '@/lib/community/hooks';
import { useSeats } from '@/lib/community/enrollment';
import {
  bySlug, isPast, recordingReady, recordingState, dayShort, time, dateFull, workshopUrl,
} from '@/lib/community/workshops';

/* "My workshops" — every seat you've taken, the Meet links, and every recording
   you can watch again.

   Identity comes from the SERVER: app/dashboard/page.jsx reads the Supabase
   session and the `profiles` row and passes down only the minimal fields. That
   file is untouched — this is purely the surface.

   NOTE: the assignment submit-link form is still intentionally not rendered, as
   in the previous design. Its Supabase backend stays preserved and dormant —
   app/dashboard/actions.js (the submitAssignment server action) plus the
   `submissions` table. To re-enable, render a form here and call
   submitAssignment({ link, note }); lib/logic/dashboard.js still holds the
   field handlers it used to drive. */
export default function DashboardClient({ name, email, avatarUrl, initials, firstName, workshops, loadError }) {
  const { user } = useSession();
  const { seats } = useSeats(user?.id);

  const mine = Object.keys(seats)
    .map((slug) => ({ slug, ...seats[slug], workshop: bySlug(slug, workshops) }))
    .filter((e) => e.workshop);

  const coming = mine
    .filter((e) => !isPast(e.workshop))
    .sort((a, b) => new Date(a.workshop.dateTime) - new Date(b.workshop.dateTime));
  const been = mine
    .filter((e) => isPast(e.workshop))
    .sort((a, b) => new Date(b.workshop.dateTime) - new Date(a.workshop.dateTime));

  useReveal([mine.length, user?.id]);

  return (
    <SiteShell active="account">
      <div className="wrap page-top" style={{ paddingBottom: 'clamp(56px,8vw,96px)' }}>
        <header className="sec-head">
          <div className="main">
            <span className="eyebrow">Your account</span>
            <h1 style={{ marginTop: 20, fontSize: 'clamp(2.3rem,4.6vw,3.4rem)' }}>My workshops</h1>
          </div>
          <p className="aside">
            Every seat you&rsquo;ve taken, the Meet links, and every recording you can watch again.
          </p>
        </header>

        <div className="acct-id">
          <span className="pic">
            {avatarUrl ? <img src={avatarUrl} alt={name} /> : initials || 'U'}
          </span>
          <div className="facts" style={{ marginTop: 0 }}>
            <span className="fact mint">{name}</span>
            {email && <span className="fact">{email}</span>}
          </div>
        </div>

        {loadError ? (
          <div className="callout plain" style={{ marginTop: 36 }}>
            <h3>Could not load the workshops.</h3>
            <p>The list did not come through. Refresh the page and try again.</p>
          </div>
        ) : !mine.length ? (
          <div className="callout plain" style={{ marginTop: 36 }}>
            <h3>Nothing here yet, {firstName}</h3>
            <p>Grab a seat and it&rsquo;ll show up here with your Meet link.</p>
            <div className="cta-row">
              <Link className="btn go" href="/workshops">
                See workshops
              </Link>
            </div>
          </div>
        ) : (
          <>
            {!!coming.length && (
              <>
                <h2 className="group-h">
                  Coming up <span className="count">{coming.length}</span>
                </h2>
                {coming.map((e) => (
                  <Row key={e.slug} e={e} />
                ))}
              </>
            )}

            {!!been.length && (
              <>
                <h2 className="group-h">
                  Been to <span className="count">{been.length}</span>
                </h2>
                {been.map((e) => (
                  <Row key={e.slug} e={e} />
                ))}
              </>
            )}

            {!coming.length && (
              <div className="banner info" style={{ marginTop: 28 }}>
                <span>
                  Nothing coming up. <Link href="/workshops">Grab a seat</Link> for the next one.
                </span>
              </div>
            )}
          </>
        )}
      </div>
    </SiteShell>
  );
}

/* Status label is always text, never colour alone. */
function Row({ e }) {
  const w = e.workshop;
  const url = workshopUrl(w);
  const past = isPast(w);

  let statusCls = 'reg';
  let statusText = 'Registered';
  let sub = `${dayShort(w.dateTime)} · ${time(w.dateTime)} · Meet link lands the day before`;
  let action = null;

  if (past) {
    statusCls = 'att';
    statusText = e.status === 'WAITLISTED' ? 'Waitlisted — didn’t make it' : 'Been there';
    sub = dateFull(w.dateTime);
    action = recordingReady(w) ? (
      <Link className="linkish" href={`${url}#recording`}>
        Watch it again
      </Link>
    ) : recordingState(w) === 'coming' ? (
      <span className="micro">Recording on its way</span>
    ) : (w.resources || []).length ? (
      <Link className="linkish" href={`${url}#files`}>
        Get the files
      </Link>
    ) : null;
  } else if (w.meetLink) {
    action = (
      <a className="btn sm" href={w.meetLink} target="_blank" rel="noopener noreferrer">
        Join on Meet
      </a>
    );
    sub = `${dayShort(w.dateTime)} · ${time(w.dateTime)} · Meet link’s ready`;
  }

  if (!past && e.status === 'REGISTERED' && e.whatsapp) sub += ` · Reminder to ${e.whatsapp}`;

  return (
    <div className="arow">
      <div>
        <div className="t">
          <Link href={url}>{w.title}</Link>
        </div>
        <div className="s">{sub}</div>
      </div>
      <div className="right">
        <span className={'status ' + statusCls}>{statusText}</span>
        {action}
      </div>
    </div>
  );
}
