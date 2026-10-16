'use client';
import { useMemo, useState, useTransition } from 'react';
import SiteShell from '@/components/community/SiteShell';
import AdminTabs from '../AdminTabs';
import styles from '../registrations/registrations.module.css';
import { MENTORING_PRICE_INR } from '@/lib/review/content';
import { setBookingStatus } from './actions';

/* The 1:1 mentoring requests from /review/book, newest first. A request moves
   NEW → CONFIRMED (time agreed) → PAID → DONE, or CANCELLED. The WhatsApp
   button opens a chat with a first message already written. */

const STATUSES = [
  ['NEW', 'New'],
  ['CONFIRMED', 'Time confirmed'],
  ['PAID', 'Paid'],
  ['DONE', 'Done'],
  ['CANCELLED', 'Cancelled'],
];
const LABEL = Object.fromEntries(STATUSES);

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function when(sec) {
  if (!sec) return '';
  const d = new Date(sec * 1000);
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
  })
    .formatToParts(d)
    .reduce((a, x) => ((a[x.type] = x.value), a), {});
  return `${p.day} ${MON[Number(p.month) - 1]} · ${p.hour}:${p.minute}${p.dayPeriod}`;
}

const bare = (u) => String(u || '').replace(/^https?:\/\//, '').replace(/\/$/, '');

function waLink(b) {
  const first = String(b.name || '').trim().split(/\s+/)[0] || 'there';
  const text =
    `Hi ${first}, this is the RPS team about your 1:1 portfolio call. ` +
    `You picked ${String(b.slot || '').toLowerCase()} — would [day, time] work for you? ` +
    `Once you confirm, we'll send the ₹${b.priceInr || MENTORING_PRICE_INR} payment link.`;
  return `https://wa.me/${String(b.whatsapp || '').replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;
}

export default function BookingsClient({ rows, failed }) {
  const [filter, setFilter] = useState('open');
  const [q, setQ] = useState('');
  const [problem, setProblem] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [local, setLocal] = useState({}); // status changes shown before the page re-reads
  const [, startTransition] = useTransition();

  const list = useMemo(() => rows.map((b) => ({ ...b, status: local[b.id] || b.status })), [rows, local]);

  const counts = useMemo(() => {
    const c = { open: 0, all: list.length };
    STATUSES.forEach(([k]) => (c[k] = 0));
    list.forEach((b) => {
      c[b.status] = (c[b.status] || 0) + 1;
      if (b.status !== 'DONE' && b.status !== 'CANCELLED') c.open += 1;
    });
    return c;
  }, [list]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return list.filter((b) => {
      if (filter === 'open' && (b.status === 'DONE' || b.status === 'CANCELLED')) return false;
      if (filter !== 'open' && filter !== 'all' && b.status !== filter) return false;
      if (!needle) return true;
      return [b.name, b.email, b.whatsapp, b.portfolioUrl].filter(Boolean).some((v) => v.toLowerCase().includes(needle));
    });
  }, [list, filter, q]);

  const paid = list.filter((b) => b.status === 'PAID' || b.status === 'DONE').length;

  function move(b, status) {
    if (b.status === status) return;
    setProblem('');
    setBusyId(b.id);
    setLocal((l) => ({ ...l, [b.id]: status }));
    startTransition(async () => {
      const res = await setBookingStatus(b.id, status);
      setBusyId(null);
      if (!res.ok) {
        setLocal((l) => ({ ...l, [b.id]: b.status }));
        setProblem(res.error || 'Could not save that.');
      }
    });
  }

  return (
    <SiteShell active="">
      <div className={'wrap page-top ' + styles.page}>
        <AdminTabs current="bookings" />

        <header className={styles.head}>
          <div className={styles.picked}>
            <span className={styles.eyebrow}>Admin</span>
            <h1 className={styles.title}>1:1 bookings</h1>
            <p className={styles.sub}>
              {counts.all} {counts.all === 1 ? 'request' : 'requests'}
              {' · '}{counts.open} open
              {' · '}{paid} paid
              {' · '}₹{(paid * MENTORING_PRICE_INR).toLocaleString('en-IN')} at ₹{MENTORING_PRICE_INR} a call
            </p>
          </div>
        </header>

        {failed && (
          <div className={styles.warn} role="alert">
            The bookings could not be read: {failed} Is the review engine running?
          </div>
        )}

        <div className={styles.controls}>
          <input
            className={styles.search}
            type="search"
            placeholder="Search name, email, number or portfolio"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search bookings"
          />
          <div className={styles.seg} role="group" aria-label="Filter by status">
            {[['open', 'Open', counts.open], ...STATUSES.map(([k, l]) => [k, l, counts[k]]), ['all', 'All', counts.all]].map(
              ([value, label, n]) => (
                <button
                  key={value}
                  type="button"
                  className={styles.segBtn}
                  aria-pressed={filter === value}
                  onClick={() => setFilter(value)}
                >
                  {label}
                  <span className={styles.segN}>{n}</span>
                </button>
              )
            )}
          </div>
        </div>

        {problem && <div className={styles.warn} role="alert">{problem}</div>}

        {shown.length ? (
          <div className={styles.scroller}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Requested</th>
                  <th scope="col">Name</th>
                  <th scope="col">Contact</th>
                  <th scope="col">Portfolio</th>
                  <th scope="col">When suits them</th>
                  <th scope="col">Help with</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((b) => (
                  <tr key={b.id}>
                    <td className={styles.num}>{when(b.created)}</td>
                    <td className={styles.strong}>{b.name}</td>
                    <td>
                      <a href={waLink(b)} target="_blank" rel="noopener noreferrer">
                        {b.whatsapp}
                      </a>
                      <br />
                      <a href={`mailto:${b.email}`}>{b.email}</a>
                    </td>
                    <td>
                      {b.portfolioUrl ? (
                        <a href={b.portfolioUrl} target="_blank" rel="noopener noreferrer">
                          {bare(b.portfolioUrl)}
                        </a>
                      ) : (
                        <span className={styles.faint}>—</span>
                      )}
                    </td>
                    <td>{b.slot}</td>
                    <td className={styles.note}>{b.topic || <span className={styles.faint}>—</span>}</td>
                    <td className={styles.actionsCell}>
                      <select
                        className={styles.select}
                        value={b.status}
                        disabled={busyId === b.id}
                        onChange={(e) => move(b, e.target.value)}
                        aria-label={`Status for ${b.name}`}
                      >
                        {STATUSES.map(([k, l]) => (
                          <option key={k} value={k}>
                            {l}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className={styles.empty}>
            <h2>{counts.all ? `No ${filter === 'open' ? 'open' : LABEL[filter]?.toLowerCase() || ''} requests` : 'No bookings yet'}</h2>
            <p>Requests from the “Book a 1:1 call” form land here.</p>
          </div>
        )}
      </div>
    </SiteShell>
  );
}
