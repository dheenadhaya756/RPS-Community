'use client';
import { useMemo, useState } from 'react';
import SiteShell from '@/components/community/SiteShell';
import AdminTabs from '../AdminTabs';
import styles from '../registrations/registrations.module.css';

/* Everyone who has made an account, for emailing. A view over rows the server
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

/* Excel and Sheets read a leading = + - @ as a formula, so a value starting
   with one is defused with an apostrophe; the quoting handles the rest. */
function csvCell(value) {
  const s = String(value ?? '');
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

export default function LoginsClient({ rows, failed, workshopsError, viewer }) {
  const [q, setQ] = useState('');
  const [which, setWhich] = useState('all'); // 'all' | 'seat' | 'none'
  const [copied, setCopied] = useState('');

  const counts = useMemo(() => {
    const seat = rows.filter((r) => r.workshops.length).length;
    return { all: rows.length, seat, none: rows.length - seat };
  }, [rows]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (which === 'seat' && !r.workshops.length) return false;
      if (which === 'none' && r.workshops.length) return false;
      if (!needle) return true;
      return [r.name, r.email, r.mobile, r.organisation]
        .filter(Boolean)
        .some((v) => v.toLowerCase().includes(needle));
    });
  }, [rows, q, which]);

  /* What this page is for: every address on screen, ready to paste into Bcc.
     Comma-separated, which Gmail, Outlook and Apple Mail all accept. */
  async function copyEmails() {
    const list = [...new Set(shown.map((r) => r.email).filter(Boolean))];
    if (!list.length) return;
    try {
      await navigator.clipboard.writeText(list.join(', '));
      setCopied(`${list.length} ${list.length === 1 ? 'address' : 'addresses'} copied — paste them into Bcc.`);
    } catch {
      setCopied('Your browser blocked the clipboard. Use Export CSV instead.');
    }
  }

  function exportCsv() {
    const header = ['Joined (IST)', 'Name', 'Email', 'Mobile', 'Organisation', 'Signed in with', 'Last login (IST)', 'Workshops'];
    const body = shown.map((r) => [
      whenExact(r.createdAt), r.name, r.email, r.mobile, r.organisation, r.via,
      whenExact(r.lastSignInAt), r.workshops.join(' + '),
    ]);
    // The BOM is what makes Excel open UTF-8 correctly.
    const csv = '﻿' + [header, ...body].map((row) => row.map(csvCell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `rps-logins-${which}-${whenExact(new Date().toISOString()).slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <SiteShell active="">
      <div className={'wrap page-top ' + styles.page}>
        <AdminTabs current="logins" />

        <header className={styles.head}>
          <div className={styles.picked}>
            <span className={styles.eyebrow}>Admin</span>
            <h1 className={styles.title}>Logins</h1>
            <p className={styles.sub}>
              {counts.all} {counts.all === 1 ? 'account' : 'accounts'}
              {' · '}{counts.seat} registered for a workshop
              {' · '}{counts.none} not yet
            </p>
          </div>
          <div className={styles.headActions}>
            <button className="btn ghost" type="button" onClick={copyEmails} disabled={!shown.length}>
              Copy emails
            </button>
            <button className="btn go" type="button" onClick={exportCsv} disabled={!shown.length}>
              Export CSV
            </button>
          </div>
        </header>

        {failed && (
          <div className={styles.warn} role="alert">
            The account list could not be read. The page is fine — the call to Supabase
            failed. If this persists, check that SUPABASE_SERVICE_ROLE_KEY is set on the server.
          </div>
        )}
        {workshopsError && (
          <div className={styles.warn} role="alert">
            Could not load the workshops. Accounts are still listed, but a seat shows its
            slug instead of the cohort name.
          </div>
        )}

        <div className={styles.controls}>
          <input
            id="login-search"
            className={styles.search}
            type="search"
            placeholder="Search name, email, mobile or organisation"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search accounts"
          />
          <div className={styles.seg} role="group" aria-label="Filter by workshop seat">
            {[
              ['all', 'Everyone', counts.all],
              ['seat', 'Registered for a workshop', counts.seat],
              ['none', 'No workshop yet', counts.none],
            ].map(([value, label, n]) => (
              <button
                key={value}
                type="button"
                className={styles.segBtn}
                aria-pressed={which === value}
                onClick={() => { setWhich(value); setCopied(''); }}
              >
                {label}
                <span className={styles.segN}>{n}</span>
              </button>
            ))}
          </div>
        </div>

        {copied && <div className={styles.note2} role="status">{copied}</div>}

        {shown.length === 0 ? (
          <div className={styles.empty}>
            <h2>{rows.length ? 'Nothing matches that.' : 'Nobody has made an account yet.'}</h2>
            <p>
              {rows.length
                ? 'Try a different search, or set the filter back to everyone.'
                : 'Accounts appear here the moment someone signs up — no import, no sync.'}
            </p>
          </div>
        ) : (
          <div className={styles.scroller}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Joined</th>
                  <th scope="col">Name</th>
                  <th scope="col">Email</th>
                  <th scope="col">Mobile</th>
                  <th scope="col">Signed in with</th>
                  <th scope="col">Last login</th>
                  <th scope="col">Workshops</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id}>
                    <td className={styles.num}>{whenShort(r.createdAt)}</td>
                    <td className={styles.strong}>
                      {r.name || <span className={styles.faint}>&mdash;</span>}
                      {r.organisation && <span className={styles.note}>{r.organisation}</span>}
                    </td>
                    <td><a href={`mailto:${r.email}`}>{r.email}</a></td>
                    <td className={styles.num}>
                      {r.mobile || <span className={styles.faint}>&mdash;</span>}
                    </td>
                    <td>{r.via || <span className={styles.faint}>&mdash;</span>}</td>
                    <td className={styles.num}>
                      {/* An email signup that never confirmed has no sign-in yet. */}
                      {r.lastSignInAt ? whenShort(r.lastSignInAt) : <span className={styles.faint}>Never</span>}
                    </td>
                    <td>
                      {r.workshops.length
                        ? r.workshops.join(', ')
                        : <span className={styles.faint}>&mdash;</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className={styles.foot}>
          Every account on the site, newest first — whether or not they took a seat. Workshop
          seats are on the registrations list.
          <br />
          Signed in as {viewer} · visible to named addresses only.
        </p>
      </div>
    </SiteShell>
  );
}
