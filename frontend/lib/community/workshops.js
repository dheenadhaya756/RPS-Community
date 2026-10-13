/* =============================================================================
   Derived workshop state + IST formatting.
   Ported from the community website's assets/js/store.js — the read-only half.
   Status is always derived from `dateTime`, never a stored flag.
   ============================================================================= */

import { FAQS } from './content';

function source(list) {
  return Array.isArray(list) ? list : [];
}

export function allWorkshops(list) {
  return source(list).slice().sort((a, b) => new Date(a.dateTime) - new Date(b.dateTime));
}

export function bySlug(slug, list) {
  return source(list).find((w) => w.slug === slug) || null;
}

export function byId(id, list) {
  return source(list).find((w) => w.id === id) || null;
}

export function isPast(w) {
  return new Date(w.dateTime) < new Date();
}

export function recordingReady(w) {
  return !!w.recordingUrl;
}

/* Where a past workshop's recording is up to: 'ready' once there is a link,
   'none' only when the content says so outright (`recordingUrl: false`), and
   otherwise 'coming'. Every session is recorded, and the days between it
   running and the link going up are the normal case, not the exception — so
   the page says "on its way" on its own, and nobody has to remember to set a
   flag to stop it saying "not recorded" to the people who just attended. */
export function recordingState(w) {
  if (!w || !isPast(w)) return null;
  if (w.recordingUrl) return 'ready';
  if (w.recordingUrl === false) return 'none';
  return 'coming';
}

/* How a recordingUrl plays on the page. Paste the link as you'd copy it —
   a YouTube watch/share link (unlisted is fine), a Vimeo link, a Google Drive
   file link (shared "anyone with the link"), or a direct .mp4/.webm file —
   and this works out the embeddable form. Returns null for anything else,
   which the page treats as "open it in a new tab" rather than guessing.
   Every host here must also be allowed by frame-src in next.config.js. */
export function recordingEmbed(url) {
  if (!url) return null;
  let u;
  try {
    u = new URL(url, 'https://cohorts.rockpaperscissors.studio');
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\./, '');

  if (/\.(mp4|webm|m4v|mov)$/i.test(u.pathname)) return { kind: 'video', src: u.href };

  let yt = null;
  if (host === 'youtu.be') yt = u.pathname.slice(1);
  else if (/(^|\.)youtube\.com$/.test(host)) {
    yt = u.searchParams.get('v') || (u.pathname.match(/^\/(?:embed|live|shorts)\/([^/?]+)/) || [])[1];
  }
  // The player sits on the page ready, not running: nothing autoplays. The
  // standard YouTube embed keeps the channel and "Watch on YouTube" links, so
  // anyone can carry on to the channel to like and subscribe.
  if (yt) {
    return {
      kind: 'iframe',
      provider: 'youtube',
      src: `https://www.youtube.com/embed/${yt}?rel=0`,
      watchUrl: `https://www.youtube.com/watch?v=${yt}`,
    };
  }

  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const id = (u.pathname.match(/(\d{6,})/) || [])[1];
    if (id) return { kind: 'iframe', src: `https://player.vimeo.com/video/${id}?dnt=1` };
  }

  if (host === 'drive.google.com') {
    const id = (u.pathname.match(/\/file\/d\/([^/]+)/) || [])[1] || u.searchParams.get('id');
    if (id) return { kind: 'iframe', src: `https://drive.google.com/file/d/${id}/preview` };
  }

  return null;
}

export function upcoming(list) {
  return allWorkshops(list).filter((w) => !isPast(w));
}

export function past(list) {
  return allWorkshops(list).filter(isPast).reverse();
}

export function featuredPast(list) {
  const rows = past(list);
  return rows.find((w) => w.featured) || rows[0] || null;
}

export function faqs() {
  return FAQS.slice().sort((a, b) => a.order - b.order);
}

export function testimonials(workshopId, list) {
  if (!Array.isArray(list)) return [];
  if (workshopId) return list.find((w) => w.id === workshopId)?.quotes || [];
  return list.flatMap((w) => (w.quotes || []).filter((t) => t.featured));
}

function quoteText(list) {
  return (list || []).filter((t) => String(t.quote || '').trim()).slice(0, 4);
}

function featuredQuotes(w) {
  return quoteText((w?.quotes || []).filter((t) => t.featured));
}

/* Detail-page quotes. An upcoming workshop shows the last finished session's
   featured quotes, or the session just before that if the last one has none.
   A past workshop shows its own featured quotes, or the session just before
   it when it has none. */
export function detailQuotes(workshop, list) {
  const finished = past(list);
  const labelFor = (w) => (w?.cohortLabel ? `What ${w.cohortLabel} said` : 'From earlier cohorts');
  const from = (w) => {
    if (!w) return [];
    const featured = featuredQuotes(w);
    return featured.length ? featured : quoteText(w.quotes);
  };

  if (!workshop || !isPast(workshop)) {
    const last = finished[0];
    const source = featuredQuotes(last).length ? last : finished[1];
    const quotes = from(source);
    return { quotes, label: quotes.length ? labelFor(source) : 'What people said' };
  }

  const own = featuredQuotes(workshop);
  if (own.length) return { quotes: own, label: 'What people said' };

  const index = finished.findIndex((w) => w.id === workshop.id);
  const earlier = index >= 0 ? finished[index + 1] : null;
  const borrowed = from(earlier);
  if (borrowed.length) return { quotes: borrowed, label: labelFor(earlier) };

  const leftover = quoteText(workshop.quotes);
  return { quotes: leftover, label: 'What people said' };
}

/* Seat counts, the "N of M seats left" meter and the derived full/waitlist
   state used to live here. They're gone on purpose: the site no longer shows
   remaining capacity anywhere, so there's nothing left to derive it for.
   Enrolment itself is unaffected — the server still owns who has a seat. */

export function initialsFrom(name) {
  return String(name || '')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('');
}

/* ---------------------------------------------------------------- formatting
   Everything renders in IST regardless of where the reader is, because the
   sessions run to IST. Months are assembled by hand rather than left to a
   locale (en-GB abbreviates September as "Sept"). */

const IST = 'Asia/Kolkata';
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function parts(iso) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: IST,
    weekday: 'short',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
    .formatToParts(new Date(iso))
    .reduce((a, p) => ((a[p.type] = p.value), a), {});
}

// "Sat 12 Sep"
export function dayShort(iso) {
  const p = parts(iso);
  return `${p.weekday} ${p.day} ${MON[Number(p.month) - 1]}`;
}

// "12 Jul 2026"
export function dateFull(iso) {
  const p = parts(iso);
  return `${p.day} ${MON[Number(p.month) - 1]} ${p.year}`;
}

// "6PM IST" / "6:30PM IST"
export function time(iso) {
  const p = parts(iso);
  const mins = p.minute === '00' ? '' : ':' + p.minute;
  return `${p.hour}${mins}${p.dayPeriod.toUpperCase()} IST`;
}

export function metaLine(w, h) {
  const who = h ? ` · with ${h.name}` : '';
  return isPast(w)
    ? `Held ${dateFull(w.dateTime)}${who}`
    : `${dayShort(w.dateTime)} · ${time(w.dateTime)} · Google Meet${who}`;
}

// "12 Jul 2026" → { dy:'12', mo:'JUL' } for the little calendar tile
export function calParts(iso) {
  const bits = dateFull(iso).split(' ');
  return { dy: bits[0], mo: (bits[1] || '').toUpperCase() };
}

/* Where "Grab a seat" should go: the next open session, with the registration
   form already open. `?action=enroll` is what the workshop page reads to put
   the name/email/WhatsApp panel up on arrival, so the button lands on the thing
   it names rather than on a page with the same button further down.
   Nothing upcoming → the listing, which owns the empty state. */
export function seatUrl(list) {
  const next = upcoming(list)[0];
  return next ? `/workshops/${encodeURIComponent(next.slug)}?action=enroll` : '/workshops';
}

/* "Add to calendar" — a Google Calendar template link, which is the calendar
   these sessions already live in. The stamps go over in UTC so the entry lands
   at the right local hour wherever the reader keeps their calendar, even though
   everything on the site is written in IST. */
function stampUTC(d) {
  return new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

export function calendarUrl(w) {
  if (!w || !w.dateTime) return '';
  const start = new Date(w.dateTime);
  const end = new Date(start.getTime() + (w.durationMins || 90) * 60000);
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: w.title || 'RPS Cohorts workshop',
    dates: `${stampUTC(start)}/${stampUTC(end)}`,
    details: [w.summary, w.meetLink ? `Meet: ${w.meetLink}` : ''].filter(Boolean).join('\n\n'),
    location: w.meetLink || 'Google Meet',
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/* `description` is one paragraph on some workshops and several on others.
   Every renderer normalises it through here rather than each one guessing,
   so adding a paragraph to the content is never also a change to a page. */
/* "90 minutes" / "2 hours" / "1 hour". Whole hours read as hours; anything else
   stays in minutes, because "1 hour 30 minutes" is a worse way to say 90 for a
   session length. One formatter so the page, the seat panel and the email can
   never disagree about how long a workshop runs. */
export function durationLabel(w) {
  const mins = Number(w?.durationMins) || 90;
  if (mins % 60 === 0) {
    const hrs = mins / 60;
    return hrs === 1 ? '1 hour' : `${hrs} hours`;
  }
  return `${mins} minutes`;
}

/* The same length at card size: "2h", "1h 30m", "45 min". */
export function durationShort(w) {
  const mins = Number(w?.durationMins) || 90;
  if (mins % 60 === 0) return `${mins / 60}h`;
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

export function paragraphs(value) {
  return (Array.isArray(value) ? value : [value]).filter(Boolean);
}

export function workshopUrl(w) {
  return `/workshops/${encodeURIComponent(w.slug)}`;
}

/* The same page, but asking for the seat form on arrival. Use this on the
   buttons that say "Grab a seat"; use workshopUrl() on titles and banners,
   where someone is going to read the brief, not to register. */
export function enrollUrl(w) {
  return `${workshopUrl(w)}?action=enroll`;
}

/* Hand a resource over for real. Used by the row's own button and by the
   deferred hand-off that fires when someone comes back from logging in, so
   both paths do the same thing: a `download` for files, a new tab for links. */
export function downloadResource(r) {
  if (!r || !r.fileUrl || r.fileUrl === '#') return false;
  if (typeof document === 'undefined') return false;
  const a = document.createElement('a');
  a.href = r.fileUrl;
  a.rel = 'noopener';
  if (r.type === 'link') a.target = '_blank';
  else a.download = r.fileName || '';
  document.body.appendChild(a);
  a.click();
  a.remove();
  return true;
}

/* Everyone running a session, in the order stored on the workshop. */
export function hostsOf(w) {
  if (!w || !Array.isArray(w.hosts)) return [];
  return w.hosts;
}

/* "Vivin Richard" for one; first names for several — "Vivin, Vineet,
   Vishal and Nikhil" — which is how a line of four full names fits. */
export function hostNames(list) {
  if (!list || !list.length) return '';
  if (list.length === 1) return list[0].name;
  const firsts = list.map((h) => h.name.split(' ')[0]);
  return firsts.slice(0, -1).join(', ') + ' and ' + firsts[firsts.length - 1];
}
