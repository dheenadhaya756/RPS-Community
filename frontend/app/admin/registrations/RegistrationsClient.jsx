'use client';
import { useMemo, useState, useTransition } from 'react';
import SiteShell from '@/components/community/SiteShell';
import { StatusChip } from '@/components/community/Bits';
import AdminTabs from '../AdminTabs';
import styles from './registrations.module.css';
import { setEnrollmentStatus, removeEnrollment, restoreEnrollment } from './actions';
import EmailBox from './EmailBox';

/* The list the team works from. Everything here is a view over rows the server
   already decided this person may see — the filtering is convenience, never a
   permission boundary. */

const IST = 'Asia/Kolkata';
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function istParts(iso) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: IST,
    year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  })
    .formatToParts(new Date(iso))
    .reduce((a, p) => ((a[p.type] = p.value), a), {});
}

// "14 Sep · 2:42PM"
function whenShort(iso) {
  if (!iso) return '';
  const p = istParts(iso);
  return `${p.day} ${MON[Number(p.month) - 1]} · ${p.hour}:${p.minute}${p.dayPeriod.toUpperCase()}`;
}

// "2026-09-14 14:42" — sorts and reads the same in a spreadsheet.
function whenExact(iso) {
  if (!iso) return '';
  const p = istParts(iso);
  const h24 = (Number(p.hour) % 12) + (p.dayPeriod.toUpperCase() === 'PM' ? 12 : 0);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')} ` +
    `${String(h24).padStart(2, '0')}:${p.minute}`;
}

/* Excel and Sheets both read a leading = + - @ as the start of a formula, so a
   name or note beginning with one would execute on open. Prefixing an
   apostrophe is the standard defusal; the quoting handles the rest. */
function csvCell(value) {
  const s = String(value ?? '');
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

export default function RegistrationsClient({ rows, failed, workshopsError, viewer, workshops, initialSlug, since, trash = [], hasAudit = true }) {
  const [q, setQ] = useState('');
  // Opens on the most recent session rather than on everything at once: the
  // question this page gets asked is almost always about the next one.
  const [slug, setSlug] = useState(initialSlug);
  const [status, setStatus] = useState('all');
  const [busyId, setBusyId] = useState(null);
  // Which row is asking "remove?" — one at a time, so a second click elsewhere
  // puts the question away rather than arming two of them.
  const [confirmId, setConfirmId] = useState(null);
  const [problem, setProblem] = useState('');
  const [removed, setRemoved] = useState('');
  const [showTrash, setShowTrash] = useState(false);
  const [showMail, setShowMail] = useState(false);
  const [, startTransition] = useTransition();

  const selected = workshops.find((w) => w.slug === slug) || null;

  // Filtered by workshop only — what the counts below are counting, and what
  // the status filter then narrows.
  const inWorkshop = useMemo(
    () => (slug === 'all' ? rows : rows.filter((r) => r.slug === slug)),
    [rows, slug]
  );

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return inWorkshop.filter((r) => {
      if (status !== 'all' && r.status !== status) return false;
      if (!needle) return true;
      return [r.name, r.email, r.whatsapp]
        .filter(Boolean)
        .some((v) => v.toLowerCase().includes(needle));
    });
  }, [inWorkshop, q, status]);

  /* Counts describe the selected workshop, not the database. A number next to a
     name that is filtered out would be answering a question nobody asked. */
  const counts = useMemo(() => {
    const c = { REGISTERED: 0, WAITLISTED: 0, ATTENDED: 0 };
    inWorkshop.forEach((r) => { if (c[r.status] !== undefined) c[r.status] += 1; });
    return c;
  }, [inWorkshop]);

  /* Approve or reject one person. The server re-checks who is asking and
     revalidates the page, so the table redraws from the database rather than
     from an optimistic guess here — the number of seats is not this component's
     to decide. */
  function move(row, next) {
    if (row.status === next || busyId) return;
    setProblem('');
    setRemoved('');
    setBusyId(row.id);
    startTransition(async () => {
      const res = await setEnrollmentStatus(row.id, next);
      setBusyId(null);
      if (!res.ok) setProblem(res.error || 'Could not save that.');
      else if (res.degraded) setProblem(res.degraded);
      else if (next === 'REJECTED') setRemoved(`${res.name || 'That registration'} was rejected.`);
    });
  }

  function restore(row) {
    if (busyId) return;
    setProblem('');
    setBusyId(row.id);
    startTransition(async () => {
      const res = await restoreEnrollment(row.id);
      setBusyId(null);
      if (res.ok) setRemoved(`${res.name || 'That registration'} is back on the list, approved.`);
      else setProblem(res.error || 'Could not restore that.');
    });
  }

  function remove(row) {
    if (busyId) return;
    setProblem('');
    setBusyId(row.id);
    startTransition(async () => {
      const res = await removeEnrollment(row.id);
      setBusyId(null);
      setConfirmId(null);
      if (!res.ok) setProblem(res.error || 'Could not remove that.');
      else if (res.degraded) setProblem(res.degraded);
      else setRemoved(`${res.name || 'That registration'} is off the list.`);
    });
  }

  function exportCsv() {
    const header = ['Registered at (IST)', 'Name', 'Email', 'WhatsApp', 'Status', 'Workshop'];
    const body = shown.map((r) => [
      whenExact(r.createdAt), r.name, r.email, r.whatsapp, r.status, r.workshop,
    ]);
    // The BOM is what makes Excel open UTF-8 correctly — without it a name with
    // an accent in it arrives mangled.
    const csv = '﻿' + [header, ...body].map((row) => row.map(csvCell).join(',')).join('\r\n');

    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url;
    const which = selected ? selected.slug : 'all-workshops';
    a.download = `rps-registrations-${which}-${whenExact(new Date().toISOString()).slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <SiteShell active="">
      <div className={'wrap page-top ' + styles.page}>
        <AdminTabs current="registrations" />

        <header className={styles.head}>
          <div className={styles.picked}>
            <span className={styles.eyebrow}>Admin</span>
            <h1 className={styles.title}>Registrations</h1>

            {/* Small on purpose. It says which session is on screen and swaps
                it; it is not the headline. */}
            <div className={styles.pickWrap}>
              <select
                id="reg-workshop"
                className={styles.pick}
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                aria-label="Which workshop"
              >
                {workshops.map((w) => (
                  <option key={w.slug} value={w.slug}>
                    {w.cohort ? w.cohort + ' · ' : ''}{w.title}
                  </option>
                ))}
                <option value="all">All workshops</option>
              </select>
            </div>

            <p className={styles.sub}>
              {selected && (
                <>
                  <span className={selected.past ? styles.tagPast : styles.tagNext}>
                    {selected.past ? 'Held' : 'Coming up'} {selected.date}
                  </span>
                  {' · '}
                </>
              )}
              {inWorkshop.length} {inWorkshop.length === 1 ? 'person' : 'people'}
              {inWorkshop.length > 0 && (
                <>
                  {/* "Approved", matching the button that sets it — one word
                      for one state, wherever it appears. */}
                  {' · '}{counts.REGISTERED} approved
                  {counts.WAITLISTED > 0 && <>{' · '}{counts.WAITLISTED} on the waitlist</>}
                  {counts.ATTENDED > 0 && <>{' · '}{counts.ATTENDED} attended</>}
                </>
              )}
            </p>
          </div>
          <div className={styles.headActions}>
            {slug !== 'all' && (
              <button
                type="button"
                className={styles.trashBtn}
                aria-pressed={showMail}
                onClick={() => setShowMail((v) => !v)}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="3" y="5" width="18" height="14" rx="2" />
                  <path d="M3 7l9 6 9-6" />
                </svg>
                Email everyone
              </button>
            )}
            <button
              type="button"
              className={styles.trashBtn}
              aria-pressed={showTrash}
              onClick={() => { setShowTrash((v) => !v); setRemoved(''); }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                <path d="M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
              </svg>
              Trash
              {trash.length > 0 && <span className={styles.segN}>{trash.length}</span>}
            </button>
            <button className="btn go" type="button" onClick={exportCsv} disabled={!shown.length}>
              Export CSV
            </button>
          </div>
        </header>

        {failed && (
          <div className={styles.warn} role="alert">
            The registration list could not be read. The page is fine — the database call
            failed. If this persists, check that SUPABASE_SERVICE_ROLE_KEY is set on the server.
          </div>
        )}
        {workshopsError && (
          <div className={styles.warn} role="alert">
            Could not load the workshops. The people below are still here, but their workshop
            names did not come through.
          </div>
        )}

        <div className={styles.controls}>
          <input
            id="reg-search"
            className={styles.search}
            type="search"
            placeholder="Search name, email or number"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search registrations"
          />
          <div className={styles.seg} role="group" aria-label="Filter by status">
            {[
              ['all', 'Everyone', inWorkshop.length],
              ['REGISTERED', 'Approved', counts.REGISTERED],
              // Only while old waitlisted rows still exist; nobody new is waitlisted.
              counts.WAITLISTED > 0 ? ['WAITLISTED', 'Waitlist', counts.WAITLISTED] : null,
            ].filter(Boolean).map(([value, label, n]) => (
              <button
                key={value}
                type="button"
                className={styles.segBtn}
                aria-pressed={status === value}
                onClick={() => setStatus(value)}
              >
                {label}
                <span className={styles.segN}>{n}</span>
              </button>
            ))}
          </div>
        </div>

        {showMail && slug !== 'all' && (
          <EmailBox
            key={slug}
            slug={slug}
            workshop={selected}
            emails={inWorkshop
              .filter((r) => r.status === 'REGISTERED' || r.status === 'ATTENDED')
              .map((r) => r.email)}
            viewer={viewer}
          />
        )}

        {problem && (
          <div className={styles.warn} role="alert">{problem}</div>
        )}
        {removed && !problem && (
          <div className={styles.note2} role="status">
            {removed} Their seat is free again, and the row is kept in the database
            if you need it back.
          </div>
        )}

        {showTrash && (
          <section className={styles.trash}>
            <h2 className={styles.trashHead}>
              Removed and rejected
              <span className={styles.trashSub}>
                {trash.length
                  ? 'Nobody is emailed from here, and their seats are free. Put one back and they’re approved again.'
                  : 'Nothing has been taken off the list.'}
              </span>
            </h2>

            {!hasAudit && trash.length > 0 && (
              <p className={styles.trashNote}>
                Who removed these is not recorded yet — run
                {' '}<code>supabase/admin-moderation.sql</code>{' '} and it will be from then on.
              </p>
            )}

            {trash.length > 0 && (
              <div className={styles.scroller}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th scope="col">Name</th>
                      <th scope="col">Email</th>
                      <th scope="col">What happened</th>
                      <th scope="col">By</th>
                      <th scope="col"><span className={styles.sr}>Restore</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {trash.map((r) => (
                      <tr key={r.id}>
                        <td className={styles.strong}>{r.name}</td>
                        <td>{r.email}</td>
                        <td>{r.status === 'REJECTED' ? 'Rejected' : 'Removed'}</td>
                        <td className={styles.num}>
                          {r.removedBy || <span className={styles.faint}>&mdash;</span>}
                          {r.removedAt && (
                            <span className={styles.note}>{whenShort(r.removedAt)}</span>
                          )}
                        </td>
                        <td className={styles.removeCell}>
                          <button
                            type="button"
                            className={styles.act}
                            disabled={busyId === r.id}
                            onClick={() => restore(r)}
                          >
                            {busyId === r.id ? 'Restoring…' : 'Put back'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {shown.length === 0 ? (
          <div className={styles.empty}>
            <h2>
              {inWorkshop.length
                ? 'Nothing matches that.'
                : 'Nobody has registered for this one yet.'}
            </h2>
            <p>
              {inWorkshop.length
                ? 'Try a different search, or set the status back to any.'
                : 'Registrations appear here the moment someone takes a seat — no import, no sync.'}
            </p>
          </div>
        ) : (
          <div className={styles.scroller}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Registered</th>
                  <th scope="col">Name</th>
                  <th scope="col">Email</th>
                  <th scope="col">WhatsApp</th>
                  <th scope="col">Status</th>
                  <th scope="col">Decision</th>
                  {slug === 'all' && <th scope="col">Workshop</th>}
                  <th scope="col"><span className={styles.sr}>Remove</span></th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r, i) => (
                  <tr key={`${r.slug}:${r.email}:${i}`}>
                    <td className={styles.num}>{whenShort(r.createdAt)}</td>
                    <td className={styles.strong}>{r.name}</td>
                    <td><a href={`mailto:${r.email}`}>{r.email}</a></td>
                    <td className={styles.num}>
                      {/* wa.me wants digits only — no +, spaces or dashes. */}
                      <a
                        href={`https://wa.me/${r.whatsapp.replace(/\D/g, '')}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {r.whatsapp}
                      </a>
                    </td>
                    <td><StatusChip status={r.status} /></td>
                    <td className={styles.actionsCell}>
                      <div className={styles.actions}>
                        {/* Both decisions are always on screen. The one already
                            in force is shown as taken rather than hidden, so a
                            row never looks like it is missing a choice. */}
                        <button
                          type="button"
                          className={styles.approve}
                          aria-pressed={r.status === 'REGISTERED'}
                          disabled={busyId === r.id || r.status === 'REGISTERED'}
                          onClick={() => move(r, 'REGISTERED')}
                        >
                          {r.status === 'REGISTERED' ? 'Approved' : 'Approve'}
                        </button>
                        <button
                          type="button"
                          className={styles.reject}
                          disabled={busyId === r.id}
                          onClick={() => move(r, 'REJECTED')}
                        >
                          Reject
                        </button>
                      </div>
                    </td>
                    {slug === 'all' && <td className={styles.workshop}>{r.workshop}</td>}
                    <td className={styles.removeCell}>
                      {confirmId === r.id ? (
                        <span className={styles.confirm}>
                          <span className={styles.ask}>Remove?</span>
                          <button
                            type="button"
                            className={styles.danger}
                            disabled={busyId === r.id}
                            onClick={() => remove(r)}
                          >
                            {busyId === r.id ? 'Removing…' : 'Yes'}
                          </button>
                          <button
                            type="button"
                            className={styles.act}
                            disabled={busyId === r.id}
                            onClick={() => setConfirmId(null)}
                          >
                            Keep
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          className={styles.remove}
                          disabled={!!busyId}
                          onClick={() => { setRemoved(''); setConfirmId(r.id); }}
                          aria-label={`Remove ${r.name} from the list`}
                        >
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className={styles.foot}>
          Everyone who registered through a workshop link since {since}. Signing up for
          an account does not appear here.
          <br />
          Signed in as {viewer} · visible to named addresses only.
        </p>
      </div>
    </SiteShell>
  );
}
