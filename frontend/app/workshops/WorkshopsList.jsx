'use client';
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import SiteShell from '@/components/community/SiteShell';
import { UpcomingCard, PastCard } from '@/components/community/WorkshopCards';
import { CONFIG } from '@/lib/community/content';
import { useReveal, useSession } from '@/lib/community/hooks';
import { useSeats } from '@/lib/community/enrollment';
import { upcoming, past } from '@/lib/community/workshops';

/* Tabs derive from dateTime, never a manual flag. Browsing is never gated —
   the gate fires on the detail page. */
export default function WorkshopsList({ workshops, loadError }) {
  const { user } = useSession();
  const { seats } = useSeats(user?.id);
  const [tab, setTab] = useState('upcoming');

  /* Default to Upcoming; #upcoming and #past both select their tab. It listens
     for hashchange as well as reading the hash on mount, because the footer
     links here from this very page — without that, clicking "Upcoming" while
     already on /workshops only changed the URL and jumped to the top. */
  useEffect(() => {
    const sync = () => {
      const h = (window.location.hash || '').replace('#', '');
      if (h === 'past' || h === 'upcoming') setTab(h);
    };
    sync();
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);

  const items = tab === 'past' ? past(workshops) : upcoming(workshops);
  const tabCounts = { upcoming: upcoming(workshops).length, past: past(workshops).length };

  useReveal([tab, user?.id]);

  const show = (which) => {
    setTab(which);
    if (typeof history !== 'undefined') history.replaceState(null, '', '#' + which);
  };

  return (
    <SiteShell active="workshops">
      <div className="wrap page-top">
        <header className="sec-head">
          <div className="main">
            <span className="eyebrow">Workshops</span>
            <h1 style={{ marginTop: 20, fontSize: 'clamp(2.3rem,4.6vw,3.6rem)', maxWidth: '15ch' }}>
              Real client work, built live.
            </h1>
          </div>
          <p className="aside">
            90 minutes on Google Meet, every few weeks. Free, recorded, and yours afterwards — the
            guide, the brief, the prompts.
          </p>
        </header>

        <div className="tabs" role="tablist" aria-label="Workshop status">
          {['upcoming', 'past'].map((k) => (
            <button
              key={k}
              className="tab"
              type="button"
              role="tab"
              id={`tab-${k}`}
              aria-controls="panel-list"
              aria-selected={tab === k}
              onClick={() => show(k)}
            >
              {k === 'upcoming' ? 'Upcoming' : 'Past & recordings'}
              <span className="n">{tabCounts[k]}</span>
            </button>
          ))}
        </div>
      </div>

      <div
        className="wrap"
        style={{
          paddingTop: 'clamp(28px,3.5vw,44px)',
          paddingBottom: 'clamp(64px,8vw,104px)',
        }}
      >
        <div id="panel-list" role="tabpanel" aria-labelledby={`tab-${tab}`}>
          {loadError ? (
            <div className="callout plain reveal">
              <h2 style={{ fontSize: 'clamp(1.6rem,2.6vw,2.1rem)' }}>Could not load the workshops.</h2>
              <p>The list did not come through. Refresh the page and try again.</p>
            </div>
          ) : !items.length ? (
            tab === 'upcoming' ? (
              <div className="callout reveal">
                <h2 style={{ fontSize: 'clamp(1.6rem,2.6vw,2.1rem)' }}>
                  Nothing on the calendar — yet
                </h2>
                <p>
                  The next one&rsquo;s being cooked. The WhatsApp group hears about a week before it
                  goes up here.
                </p>
                <div className="cta-row">
                  <a
                    className="btn go"
                    href={CONFIG.whatsappUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Join the WhatsApp group
                  </a>
                  <button className="btn ghost" type="button" onClick={() => show('past')}>
                    See the ones we&rsquo;ve run
                  </button>
                </div>
              </div>
            ) : (
              <div className="callout plain reveal">
                <h2 style={{ fontSize: 'clamp(1.6rem,2.6vw,2.1rem)' }}>No recordings yet</h2>
                <p>The first cohort&rsquo;s recording goes up once it&rsquo;s cut.</p>
              </div>
            )
          ) : tab === 'past' ? (
            <div className={'wgrid' + (items.length === 1 ? ' one' : '')}>
              {items.map((w) => (
                <PastCard key={w.id} w={w} wide={items.length === 1} mine={seats[w.slug]} />
              ))}
            </div>
          ) : (
            <div className={'wgrid' + (items.length === 1 ? ' one' : '')}>
              {items.map((w) => (
                <UpcomingCard key={w.id} w={w} mine={seats[w.slug]} />
              ))}
            </div>
          )}
        </div>
      </div>
    </SiteShell>
  );
}
