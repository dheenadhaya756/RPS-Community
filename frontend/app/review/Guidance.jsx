import { BOOKING_URL, BOOK_HREF } from '@/lib/review/content';

/* The way from a report to a person. Part of every report, not just the
   sample: the nudge sits under the fixes, where a student is most likely to
   think "how do I actually do that?", and points at the panel at the end,
   which says what a session gives them and books it. */

const bookingProps = BOOKING_URL
  ? { href: BOOKING_URL, target: '_blank', rel: 'noopener noreferrer' }
  : { href: BOOK_HREF };

/* What a person can do that the report can't. */
export const WHAT_YOU_GET = [
  'Go through your fixes together, one by one',
  'Check your portfolio against a job you want to apply for',
  'Get a designer’s eye on your visuals',
  'Practise talking about your work, like in an interview',
];

export function GuidanceNudge() {
  return (
    <div className="rv-nudge">
      <p>
        <b>Not sure how to make these fixes?</b> A designer from our team can go through them with
        you.
      </p>
      <a className="btn" href="#guidance">
        Get personal guidance
      </a>
    </div>
  );
}

/* `nextBand` is the band the fixes would take them to; at the top band there
   is nowhere further, so the pitch becomes a final check. */
export function GuidancePanel({ nextBand }) {
  return (
    <section className="rv-guide" id="guidance" aria-labelledby="rv-guide-h">
      <div className="rv-guide-copy">
        <h2 id="rv-guide-h">
          {nextBand ? <>Want help getting to &ldquo;{nextBand}&rdquo;?</> : 'Want a final check before you apply?'}
        </h2>
        <p>
          Your report shows what to fix. In a 1:1 session, a designer from RPS looks at your
          portfolio with you and helps you make the changes.
        </p>
        <a className="btn onDark lg go" {...bookingProps}>
          Book a 1:1 call
        </a>
      </div>
      <div className="rv-guide-list">
        <h3>In your session</h3>
        <ul>
          {WHAT_YOU_GET.map((w) => (
            <li key={w}>
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M3 8.5l3.2 3L13 4.5" />
              </svg>
              {w}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
