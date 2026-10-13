'use client';
import { useEffect, useMemo, useState, useTransition } from 'react';
import styles from './registrations.module.css';
import { sendWorkshopEmail, sendConfirmationTest } from './actions';
import { templatesFor, PLACEHOLDER } from '@/lib/emails/templates';

/* "Email everyone on this list" — for the workshop picked at the top of the
   page. Pick a ready-made message (the day-before reminder is the one this is
   mostly for), fill in the [bracketed] bit, send yourself a test, then send it
   to everyone approved. Sending twice never emails anyone twice: see
   sendWorkshopEmail() in ./actions.js. */

const DEFAULT_TEST_TO = 'dheena@rockpaperscissors.studio';

/* Who has had a given message, remembered in this browser — keyed by the
   workshop and the exact subject and body, so editing a word makes it a new
   message. The server skips these on the next press. */
function msgKey(slug, subject, body) {
  let h = 5381;
  const str = slug + '\u0000' + subject.trim() + '\u0000' + body.trim();
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return 'rps.sent.' + slug + '.' + (h >>> 0).toString(36);
}
function readSent(key) {
  try { return new Set(JSON.parse(localStorage.getItem(key) || '[]')); } catch { return new Set(); }
}
function writeSent(key, set) {
  try { localStorage.setItem(key, JSON.stringify([...set])); } catch { /* private mode */ }
}

export default function EmailBox({ slug, workshop, emails = [], viewer }) {
  const templates = useMemo(() => templatesFor(workshop), [workshop]);

  const [pick, setPick] = useState(templates[0]?.id || 'blank');
  const [subject, setSubject] = useState(templates[0]?.subject || '');
  const [body, setBody] = useState(templates[0]?.body || '');
  const [testTo, setTestTo] = useState(DEFAULT_TEST_TO || viewer || '');
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState(null); // { kind: 'ok' | 'warn', text }
  const [busy, startTransition] = useTransition();

  const key = msgKey(slug, subject, body);
  const [sentSet, setSentSet] = useState(() => new Set());
  useEffect(() => setSentSet(readSent(key)), [key]);
  const list = useMemo(() => [...new Set(emails.map((e) => String(e).trim().toLowerCase()))], [emails]);
  const approved = list.length;
  const toGo = list.filter((e) => !sentSet.has(e)).length;

  if (!workshop) return null;

  const left = (subject + '\n' + body).match(PLACEHOLDER);

  function choose(id) {
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    setPick(id);
    setSubject(t.subject);
    setBody(t.body);
    setConfirming(false);
    setNote(null);
  }

  function report(res, label) {
    if (!res?.ok) return setNote({ kind: 'warn', text: res?.error || 'Could not send it.' });
    if (res.to) return setNote({ kind: 'ok', text: `Sent the “you’re in” email to ${res.to}.` });
    if (res.sentTo?.length) {
      const next = new Set([...sentSet, ...res.sentTo]);
      writeSent(key, next);
      setSentSet(next);
    }
    const bits = [`${label}: sent to ${res.sent} of ${res.total}.`];
    if (res.failed?.length) bits.push(`Didn’t go to ${res.failed.join(', ')}.`);
    if (res.remaining) bits.push(`${res.remaining} still to go — press Send again to finish. Nobody gets it twice.`);
    setNote({ kind: res.failed?.length || res.remaining ? 'warn' : 'ok', text: bits.join(' ') });
  }

  function sendTest() {
    setNote(null);
    startTransition(async () => {
      const res = await sendWorkshopEmail({ slug, subject, body, test: true, testTo });
      if (res?.ok) setNote({ kind: 'ok', text: `Test sent to ${testTo || viewer}. Check the inbox, then send it to everyone.` });
      else report(res, 'Test');
    });
  }

  function sendConfirmation() {
    setNote(null);
    startTransition(async () => report(await sendConfirmationTest({ slug, testTo }), 'Confirmation'));
  }

  /* No setup at all: a Gmail compose window in this browser's own account,
     everyone in BCC (so nobody sees anyone else's address), subject and
     message filled in. Plain text and one message for all, so {name} reads
     "there". The admin presses Send in Gmail. */
  const plain = body.replace(/\{name\}/gi, 'there');
  function openInGmail() {
    const params = new URLSearchParams({ view: 'cm', fs: '1', bcc: list.join(','), su: subject, body: plain });
    window.open('https://mail.google.com/mail/?' + params.toString(), '_blank', 'noopener');
    setNote({ kind: 'ok', text: `Opened Gmail with ${approved} ${approved === 1 ? 'person' : 'people'} in BCC. Check it, then press Send there.` });
  }
  async function copy(what, label) {
    try {
      await navigator.clipboard.writeText(what);
      setNote({ kind: 'ok', text: `${label} copied.` });
    } catch {
      setNote({ kind: 'warn', text: 'Could not copy — your browser blocked it.' });
    }
  }

  function sendAll() {
    setNote(null);
    setConfirming(false);
    startTransition(async () => report(await sendWorkshopEmail({ slug, subject, body, skip: [...sentSet] }), 'Done'));
  }

  return (
    <section className={styles.mailBox} aria-labelledby="mail-h">
      <div className={styles.mailHead}>
        <h2 id="mail-h" className={styles.mailTitle}>Email everyone on this list</h2>
        <span className={styles.trashSub}>
          Goes to the {approved} approved {approved === 1 ? 'person' : 'people'} for {workshop.cohortLabel || workshop.title},
          from cohorts@rockpaperscissors.studio, with the workshop thumbnail on top.
        </span>
      </div>

      <div className={styles.seg} role="group" aria-label="Start from">
        {templates.map((t) => (
          <button
            key={t.id}
            type="button"
            className={styles.segBtn}
            aria-pressed={pick === t.id}
            onClick={() => choose(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <label className={styles.mailLabel} htmlFor="mail-subject">Subject</label>
      <input
        id="mail-subject"
        className={styles.search}
        value={subject}
        onChange={(e) => { setSubject(e.target.value); setConfirming(false); }}
      />

      <label className={styles.mailLabel} htmlFor="mail-body">Message</label>
      <textarea
        id="mail-body"
        className={styles.mailBody}
        rows={13}
        value={body}
        onChange={(e) => { setBody(e.target.value); setConfirming(false); }}
      />
      <p className={styles.mailHint}>
        <code>{'{name}'}</code> becomes each person’s first name. Links become clickable.
        {left ? <> <b className={styles.mailNeed}>Fill in {left[0]} before sending.</b></> : null}
      </p>

      <div className={styles.mailRow}>
        <label className={styles.mailLabelInline} htmlFor="mail-test">Test to</label>
        <input
          id="mail-test"
          type="email"
          className={styles.search}
          value={testTo}
          onChange={(e) => setTestTo(e.target.value)}
        />
        <button type="button" className={styles.act} disabled={busy || !!left} onClick={sendTest}>
          Send test
        </button>
        <button type="button" className={styles.act} disabled={busy} onClick={sendConfirmation}>
          Send me the “you’re in” email
        </button>
      </div>

      <div className={styles.mailRow}>
        <span className={styles.mailLabelInline}>No setup:</span>
        <button type="button" className={styles.act} disabled={!approved || !!left} onClick={openInGmail}>
          Open in Gmail (everyone in BCC)
        </button>
        <button type="button" className={styles.act} disabled={!approved} onClick={() => copy(list.join(', '), `${approved} email addresses`)}>
          Copy all email addresses
        </button>
        <button type="button" className={styles.act} disabled={!!left} onClick={() => copy(plain, 'The message')}>
          Copy message
        </button>
      </div>

      <div className={styles.mailRow}>
        {confirming ? (
          <span className={styles.confirm}>
            <span className={styles.ask}>
              Send “{subject}” to {toGo} {toGo === 1 ? 'person' : 'people'}?
            </span>
            <button type="button" className="btn go" disabled={busy} onClick={sendAll}>
              Yes, send it
            </button>
            <button type="button" className={styles.act} disabled={busy} onClick={() => setConfirming(false)}>
              Not yet
            </button>
          </span>
        ) : (
          <button
            type="button"
            className="btn go"
            disabled={busy || !!left || !toGo || !subject.trim()}
            onClick={() => setConfirming(true)}
          >
            {busy
              ? 'Sending…'
              : approved && !toGo
                ? 'Sent to everyone ✓'
                : toGo < approved
                  ? `Send to the ${toGo} who haven’t had it`
                  : `Send to ${toGo} ${toGo === 1 ? 'person' : 'people'}`}
          </button>
        )}
      </div>

      {note && (
        <div className={note.kind === 'ok' ? styles.note2 : styles.warn} role="status">
          {note.text}
        </div>
      )}
    </section>
  );
}
