/* =============================================================================
   "Congratulations, you're in" — the mail that goes out the moment a seat is
   taken.

   There is no waitlist, so there is one version: the workshop's thumbnail, the
   good news, when and where, what's in it for them, who's running it (with
   their photos when the workshop has portraits), and a calendar button.

   Built as a string on lib/emails/layout.js rather than with a template
   library: it has to survive Gmail and Outlook, and those two want tables and
   inline styles.
   ============================================================================= */

import { sendEmail } from '@/lib/mail';
import {
  ACCENT, INK, MUTED, LINE, FONT, abs, esc, firstName, emailBanner, button, p, h2, frame,
} from '@/lib/emails/layout';
import {
  hostsOf, hostNames, dayShort, time, dateFull, calendarUrl, durationLabel, workshopUrl,
} from '@/lib/community/workshops';
import { loadPublicWorkshop } from '@/lib/community/publicWorkshops';

/* Only a real room code counts. A placeholder Meet URL must never go out —
   someone would click it the morning of the session and land nowhere. */
export function realMeetLink(w) {
  const url = String(w?.meetLink || '');
  return /^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/i.test(url) ? url : null;
}

function row(label, value) {
  return (
    '<tr>' +
    '<td style="padding:10px 0;border-bottom:1px solid ' + LINE + ';font-family:' + FONT + ';' +
    'font-size:13px;color:' + MUTED + ';width:96px;vertical-align:top;">' + esc(label) + '</td>' +
    '<td style="padding:10px 0;border-bottom:1px solid ' + LINE + ';font-family:' + FONT + ';' +
    'font-size:15px;color:' + INK + ';font-weight:600;">' + value + '</td>' +
    '</tr>'
  );
}

function sub(textValue) {
  return '<br><span style="font-weight:400;font-size:13px;color:' + MUTED + ';">' + esc(textValue) + '</span>';
}

/* "What's in it for you?" — the workshop's own list, ticked. */
function perks(w) {
  const items = (w.curriculum || []).slice(0, 6);
  if (!items.length) return '';
  return (
    '<tr><td style="padding:26px 0 0;">' +
    h2((w.curriculumTitle || 'What you’ll walk out with').replace(/\?$/, '')) +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">' +
    items
      .map(
        (i) =>
          '<tr><td style="padding:5px 10px 5px 0;vertical-align:top;width:18px;font-family:' + FONT + ';' +
          'font-size:15px;line-height:1.5;color:' + ACCENT + ';font-weight:700;">✓</td>' +
          '<td style="padding:5px 0;font-family:' + FONT + ';font-size:15px;line-height:1.5;color:' + INK + ';">' +
          esc(i) + '</td></tr>'
      )
      .join('') +
    '</table></td></tr>'
  );
}

/* The mentors, side by side with their portraits — the same photos as the
   workshop page. Two to a row keeps each one readable on a phone. */
function mentors(hs) {
  const withPhotos = hs.filter((h) => h.portraitUrl || h.photoUrl);
  if (hs.length < 2 || withPhotos.length !== hs.length) return '';
  const cell = (h) =>
    '<td width="50%" style="padding:0 6px 14px;vertical-align:top;text-align:left;">' +
    '<img src="' + esc(abs(h.portraitUrl || h.photoUrl)) + '" width="120" alt="' + esc(h.name) + '" ' +
    'style="display:block;width:120px;max-width:100%;height:auto;border:0;border-radius:10px;">' +
    '<p style="margin:10px 0 0;font-family:' + FONT + ';font-size:14px;font-weight:700;color:' + INK + ';">' +
    esc(h.name) + '</p>' +
    '<p style="margin:2px 0 0;font-family:' + FONT + ';font-size:12px;color:' + MUTED + ';">' +
    esc(h.role || h.title) + (h.years ? ' · ' + esc(h.years) + '+ yrs' : '') + '</p>' +
    '</td>';
  let rows = '';
  for (let i = 0; i < hs.length; i += 2) {
    rows += '<tr>' + cell(hs[i]) + (hs[i + 1] ? cell(hs[i + 1]) : '<td width="50%"></td>') + '</tr>';
  }
  return (
    '<tr><td style="padding:26px 0 0;">' +
    h2('Your mentors') +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">' +
    rows +
    '</table></td></tr>'
  );
}

/* ---------------------------------------------------------------- the email */
export function buildEnrollmentEmail({ name, workshop }) {
  const w = workshop;
  const hs = hostsOf(w);
  // One host reads as name and title; several as their first names together.
  const h = hs.length === 1 ? hs[0] : hs.length ? { name: hostNames(hs), title: 'Senior designers at RPS' } : null;
  const meet = realMeetLink(w);
  // Only offered alongside a real room — a PIN for a placeholder link is worse
  // than no PIN, because someone would sit on hold in an empty meeting.
  const dialIn = meet && w.meetPhone?.number && w.meetPhone?.pin ? w.meetPhone : null;
  const when = dayShort(w.dateTime) + ' · ' + time(w.dateTime);
  const mins = durationLabel(w);
  const page = abs(workshopUrl(w));
  const dashboard = abs('/dashboard');

  // Every workshop title is a full sentence ending in a full stop, so anything
  // appended to it reads as a new one ("...looking like it. on Sat 19 Sep").
  const titleLine = w.title.replace(/[.\s]+$/, '');

  const subject = 'Congratulations, you’re in! ' + titleLine + ' · ' + dayShort(w.dateTime);
  const headline = 'Congratulations, you’re in! 🎉';

  const facts =
    row('When', esc(when) + sub(dateFull(w.dateTime) + ' · ' + mins)) +
    row(
      'Where',
      meet
        ? '<a href="' + esc(meet) + '" style="color:' + ACCENT + ';text-decoration:none;">' +
          esc(meet.replace(/^https:\/\//, '')) + '</a>' +
          (dialIn ? sub('Or dial ' + dialIn.number + ' (' + dialIn.country + '), PIN ' + dialIn.pin) : '')
        : 'Google Meet' + sub('We’ll email the link the day before, and send it on WhatsApp.')
    ) +
    (h ? row('With', esc(h.name) + sub(h.title)) : '') +
    row('Cost', 'Free' + sub('No card, no upsell at the end.'));

  // calendarUrl() takes the workshop's meetLink at face value and writes it
  // into the entry's location. Hand it the checked one so a placeholder never
  // ends up saved in somebody's calendar.
  const calUrl = calendarUrl({ ...w, meetLink: meet });

  const closing =
    'Bring the tool you already use — the method holds whichever it is. A recording and the files ' +
    'follow afterwards, whether or not you make it live.';

  const body =
    '<p style="margin:0 0 10px;font-family:' + FONT + ';font-size:13px;font-weight:700;' +
    'letter-spacing:.08em;text-transform:uppercase;color:' + ACCENT + ';">' +
    esc(w.cohortLabel ? 'RPS Cohorts · ' + w.cohortLabel : 'RPS Cohorts') + '</p>' +
    '<h1 style="margin:0 0 14px;font-family:' + FONT + ';font-size:27px;line-height:1.25;color:' + INK + ';">' +
    esc(headline) + '</h1>' +
    p('Hi ' + esc(firstName(name)) + ',', { margin: '0 0 6px' }) +
    p('Your seat at <strong>' + esc(titleLine) + '</strong> is confirmed. Here’s everything you need.', {
      margin: '0 0 22px',
    }) +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ' +
    'style="border-top:1px solid ' + LINE + ';">' + facts + '</table>' +
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 0;"><tr>' +
    '<td style="padding-right:10px;">' + button(calUrl, 'Add to calendar') + '</td>' +
    '</tr></table>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">' +
    perks(w) +
    mentors(hs) +
    '</table>' +
    p(esc(closing), { size: 14, color: MUTED, margin: '22px 0 18px' });

  const footer =
    p(
      'Can’t make it? <a href="' + esc(dashboard) + '" style="color:' + MUTED + ';">Release your seat</a> ' +
        'so we know not to expect you.',
      { size: 13, color: MUTED, margin: '0 0 6px' }
    ) +
    p('You’re getting this because you registered for a workshop at RPS Cohorts.', {
      size: 12,
      color: MUTED,
      margin: '0',
    });

  const html = frame({
    title: subject,
    preview: when + ' on Google Meet. Everything you need is inside.',
    banner: emailBanner(w),
    bannerHref: page,
    body,
    footer,
  });

  /* A real alternative, not a stripped copy — every link that matters is spelled
     out, because nothing here is clickable. */
  const lines = [
    'Congratulations, you’re in!',
    '',
    'Hi ' + firstName(name) + ',',
    '',
    'Your seat at "' + titleLine + '" is confirmed.',
    '',
    'When:  ' + when + ' (' + dateFull(w.dateTime) + ', ' + mins + ')',
    'Where: ' + (meet || 'Google Meet — we’ll email the link the day before, and send it on WhatsApp.'),
    dialIn ? '       Or dial ' + dialIn.number + ' (' + dialIn.country + '), PIN ' + dialIn.pin : null,
    h ? 'With:  ' + h.name + ', ' + h.title : null,
    'Cost:  Free. No card, no upsell at the end.',
    '',
    'Add to calendar: ' + calUrl,
    (w.curriculum || []).length
      ? '\n' + (w.curriculumTitle || 'What you’ll walk out with') + '\n' +
        w.curriculum.map((i) => '  - ' + i).join('\n')
      : null,
    '',
    closing,
    '',
    'The workshop page: ' + page,
    'Can’t make it? Release your seat so we know not to expect you: ' + dashboard,
    '',
    'You’re getting this because you registered for a workshop at RPS Cohorts.',
  ];

  return { subject, html, text: lines.filter((l) => l !== null).join('\n') };
}

/* Fire the confirmation for one enrolment. Resolves to the send result and
   never throws — the caller has already saved the seat by the time this runs,
   and a mail problem must not turn that into a failure. */
export async function sendEnrollmentEmail({ to, name, slug }) {
  const { workshop, error: loadError } = await loadPublicWorkshop(slug);
  if (loadError || !workshop) {
    console.error('[mail] No workshop content for "' + slug + '" — confirmation not sent.');
    return { ok: false, error: 'Unknown workshop.' };
  }
  const { subject, html, text } = buildEnrollmentEmail({ name, workshop });
  return sendEmail({ to, subject, html, text });
}
