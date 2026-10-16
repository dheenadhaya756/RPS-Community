/* =============================================================================
   Copy and settings for /review, the portfolio review page.
   ============================================================================= */

/* Where "Book 1:1 session" goes. Empty until the booking page exists; while it
   is, the button stays on the page and goes nowhere. Paste a Cal.com, Calendly
   or Topmate link here to switch it on. */
export const BOOKING_URL = '';

/* "Book a 1:1 call" opens our own booking form. The team confirms a time and
   sends the payment link; set BOOKING_URL above to send people to an outside
   calendar instead. */
export const CONTACT_EMAIL = 'cohorts@rockpaperscissors.studio';
export const BOOK_HREF = BOOKING_URL || '/review/book';

/* Personal mentoring: one 1:1 call with an RPS designer. */
export const MENTORING_PRICE_INR = 200;

/* Free reviews per account per day (resets at midnight IST). */
export const REVIEWS_PER_DAY = 2;

/* When they'd like the call. The team confirms an exact time on WhatsApp. */
export const SLOTS = [
  'Weekday morning (10am–1pm)',
  'Weekday afternoon (2pm–6pm)',
  'Weekday evening (6pm–9pm)',
  'Weekend morning (10am–1pm)',
  'Weekend afternoon (2pm–6pm)',
];

/* What /review/report/[id] lists while a review runs. `id`s are the stages the
   review engine reports (portfolio-auditor/rps_api.py), in the order they happen. */
export const PROGRESS = [
  { id: 'opening', label: 'Opening your portfolio' },
  { id: 'scrolling', label: 'Scrolling through it like a visitor would' },
  { id: 'case_studies', label: 'Opening your case studies' },
  { id: 'reviewing', label: 'Reading it against the RPS review guidelines' },
];

export const STEPS = [
  {
    title: 'Paste your link',
    body: 'Any public link: your own site, Behance, Framer, Webflow, Notion — or your motion reel.',
  },
  {
    title: 'We check it',
    body: 'We run your portfolio against a large set of other portfolios and the review guidelines RPS designers wrote for our AI.',
  },
  {
    title: 'You get a report',
    body: 'A score, what’s working, and the fixes that matter most, in plain words.',
  },
];
