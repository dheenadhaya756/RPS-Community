'use client';
import React from 'react';
import Link from 'next/link';
import SiteShell from '@/components/community/SiteShell';
import Frame from '@/components/community/Frame';
import { MeetMock, WaMock } from '@/components/community/Mocks';
import { Faq, QuoteCard } from '@/components/community/Bits';
import { FeatureCard, PastCard } from '@/components/community/WorkshopCards';
import { GAP_TILES, BENTO_ART } from '@/lib/community/illustrations';
import { CONFIG } from '@/lib/community/content';
import { useReveal, useSession } from '@/lib/community/hooks';
import { useSeats } from '@/lib/community/enrollment';
import {
  upcoming, past, featuredPast, testimonials, faqs, seatUrl, workshopUrl, recordingReady,
} from '@/lib/community/workshops';

export default function HomeClient({ workshops, loadError }) {
  const { user } = useSession();
  const { seats } = useSeats(user?.id);

  const next = upcoming(workshops)[0];
  const last = featuredPast(workshops);
  // With nothing coming up, the two latest sessions, side by side as on the
  // listing — the same cards, the same full banners.
  const recent = past(workshops).slice(0, 2);
  // "The last room": the latest cohort's featured quotes, and every cohort's
  // if that one has none marked yet.
  const lastQuotes = last ? testimonials(last.id, workshops).filter((t) => t.featured) : [];
  const quotes = lastQuotes.length ? lastQuotes : testimonials(undefined, workshops);
  const quotedCohort = lastQuotes.length && last.cohortLabel ? last.cohortLabel.toLowerCase() : null;
  const allFaqs = faqs();
  const homeFaqs = allFaqs.filter((f) => f.home);

  useReveal([next?.id, last?.id, user?.id]);

  return (
    <SiteShell active="home">
      {/* ==================================================== HERO */}
      <section className="hero">
        <div className="wrap">
          <h1>
            Design school taught you the tool.
            <span className="soft">Nobody taught you the job.</span>
          </h1>
          <p className="lede">
            So we&rsquo;re teaching it. Live, in a Google Meet, using our actual client work — with
            whoever shows up building along.
          </p>
          <div className="cta-row">
            <Link className="btn lg go" href={seatUrl(workshops)}>
              Grab a seat
            </Link>
            <Link
              className="btn ghost lg"
              href={
                last
                  ? workshopUrl(last) + (recordingReady(last) ? '#recording' : '')
                  : '/workshops#past'
              }
            >
              {last && !recordingReady(last) ? 'See the last one' : 'Watch the last one'}
            </Link>
          </div>
        </div>

        <div className="wrap hero-media">
          <MeetMock />
        </div>
      </section>

      {/* ================================================= THE GAP */}
      <section className="section">
        <div className="wrap">
          <header className="sec-head">
            <div className="main">
              <span className="eyebrow reveal">The gap</span>
              <h2 className="reveal">The gap nobody names.</h2>
            </div>
            <p className="aside reveal">
              Six things stop new designers, and none of them are about talent. We hear the same ones
              every time we open a session.
            </p>
          </header>

          {/* The drawings are inline SVG so they take the tile's ink colour and
              flip with the theme; the accent marks use the brand orange. */}
          <div className="gapgrid">
            {GAP_TILES.map((t, i) => (
              <article className="gapcard reveal" key={i}>
                <div
                  className={'gaptile ' + t.tint}
                  dangerouslySetInnerHTML={{ __html: t.svg }}
                />
                <h3>{t.title}</h3>
              </article>
            ))}
          </div>

          <p className="closer reveal">
            Not a talent problem. A room problem. So we opened a room.
          </p>
        </div>
      </section>

      {/* ================================================ ABOUT US */}
      <section className="section band">
        <div className="wrap">
          <header className="sec-head">
            <div className="main">
              <span className="eyebrow reveal">About us</span>
              <h2 className="reveal">We&rsquo;re a design studio. We work with the door open.</h2>
            </div>
            <p className="aside reveal">
              Same people, same projects, same week. The only difference is that you can watch.
            </p>
          </header>

          <Frame
            className="reveal"
            kind="team"
            src={CONFIG.images.team}
            alt={CONFIG.imageAlt.team}
            note="Placeholder — the team group photo goes here"
            style={{ height: 'min(46vw,460px)', marginTop: 44 }}
          />

          {/* Bento: three across, then a narrow and a wide. Each tile carries
              its own small piece of art, drawn inline so it takes the tile's ink. */}
          <div className="bento">
            <article className="bt mint wide reveal">
              <div className="bt-copy">
                <h3>The day job</h3>
                <p>
                  Product and brand work for Fortune&nbsp;500 teams and startups that move fast.
                </p>
              </div>
              <div className="bt-art" dangerouslySetInnerHTML={{ __html: BENTO_ART[0] }} />
            </article>

            <article className="bt peach reveal">
              <div className="bt-copy">
                <h3>Every few weeks</h3>
                <p>
                  We take one of those live projects, open a Google Meet, and build it in front of
                  whoever shows up.
                </p>
              </div>
              <div className="bt-art" dangerouslySetInnerHTML={{ __html: BENTO_ART[1] }} />
            </article>

            <article className="bt sky reveal">
              <div className="bt-copy">
                <h3>In the room</h3>
                <p>No slides. No pre-baked demos. Real brief, real decisions, real mess.</p>
              </div>
              <div className="bt-art" dangerouslySetInnerHTML={{ __html: BENTO_ART[2] }} />
            </article>

            <article className="bt amber wide reveal">
              <div className="bt-copy">
                <h3>The catch</h3>
                <p>
                  There isn&rsquo;t one. No paid tier, no pitch at the end. We&rsquo;d rather the
                  next lot of designers be good.
                </p>
              </div>
              <ul className="bt-list">
                <li>
                  Free, always<span>no paid tier</span>
                </li>
                <li>
                  Recorded<span>yours afterwards</span>
                </li>
                <li>
                  The files too<span>brief, guide, prompts</span>
                </li>
              </ul>
            </article>
          </div>
        </div>
      </section>

      {/* =============================================== WORKSHOPS
          The homepage leads with the session you can still get into — the one
          thing a visitor came to do shouldn't live a click away. */}
      {loadError ? (
        <section className="section">
          <div className="wrap">
            <div className="callout plain">
              <h2>Could not load the workshops.</h2>
              <p>The list did not come through. Refresh the page and try again.</p>
            </div>
          </div>
        </section>
      ) : (next || last) && (
        <section className="section">
          <div className="wrap">
            <header className="sec-head">
              <div className="main">
                <span className="eyebrow reveal">Workshops</span>
                <h2 className="reveal">
                  {next ? 'Here’s what’s next.' : 'Here’s what we’ve run.'}
                </h2>
              </div>
              <Link className="btn ghost go reveal" href="/workshops">
                All workshops
              </Link>
            </header>
            {next ? (
              <FeatureCard w={next} mine={seats[next.slug]} />
            ) : (
              <div className={'wgrid' + (recent.length === 1 ? ' one' : '')}>
                {recent.map((w) => (
                  <PastCard key={w.id} w={w} mine={seats[w.slug]} />
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {/* ============================================ TESTIMONIALS */}
      {!loadError && (
      <section className="section band" id="feedback">
        <div className="wrap">
          <header className="sec-head">
            <div className="main">
              <span className="eyebrow reveal">Feedback</span>
              <h2 className="reveal">What the last room said afterwards</h2>
            </div>
            <p className="aside reveal">
              Their words, from the {quotedCohort || 'cohort'} feedback form.{' '}
              {quotedCohort && last.rating
                ? `Attendees rated the session ${last.rating} out of 5.`
                : 'Every attendee who rated the session gave it 4 or 5 out of 5.'}
            </p>
          </header>
          <div className="qcards">
            {quotes.map((t, i) => (
              <QuoteCard key={t.id} t={t} i={i} />
            ))}
          </div>
        </div>
      </section>
      )}

      {/* ===================================================== FAQ */}
      <section className="section">
        <div className="wrap faq-solo">
          <span className="eyebrow reveal">FAQ</span>
          <Faq items={homeFaqs.length ? homeFaqs : allFaqs} />
        </div>
      </section>

      {/* ====================================== WHATSAPP CTA PANEL */}
      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="cta-panel reveal">
            <div className="copy">
              <h2>The group chat is where it actually lives</h2>
              <p>
                Between workshops: what we&rsquo;re building, portfolio questions, links we
                can&rsquo;t shut up about, and the next session before it goes up here.
              </p>
              <div className="cta-row">
                <a
                  className="btn onDark go"
                  href={CONFIG.whatsappUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Join the WhatsApp group
                </a>
              </div>
            </div>
            <div className="art">
              <div className="wa-decor" aria-hidden="true" />
              <div className="wa-dots" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
              <WaMock />
            </div>
          </div>
        </div>
      </section>
    </SiteShell>
  );
}
