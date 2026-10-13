'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import SiteShell from '@/components/community/SiteShell';
import { useToasts } from '@/lib/community/hooks';
import AdminTabs from '../AdminTabs';
import styles from '../registrations/registrations.module.css';
import local from './workshops.module.css';
import { setWorkshopStatus } from './actions';

const REMOVED_TOAST = 'rps-admin-workshop-removed';

function isPast(iso) {
  if (!iso) return false;
  return new Date(iso) < new Date();
}

function whenLabel(iso) {
  if (!iso) return 'No date yet';
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(iso));
}

export default function WorkshopsClient({ viewer, workshops, loadError }) {
  const { toasts, toast } = useToasts();
  const [rows, setRows] = useState(workshops);
  const [q, setQ] = useState('');
  const [which, setWhich] = useState('all');
  const [askId, setAskId] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setRows(workshops);
  }, [workshops]);

  useEffect(() => {
    const message = sessionStorage.getItem(REMOVED_TOAST);
    if (!message) return;
    sessionStorage.removeItem(REMOVED_TOAST);
    toast(message, 'done');
  }, [toast]);

  const counts = useMemo(() => ({
    all: rows.length,
    upcoming: rows.filter((w) => !isPast(w.dateTime)).length,
    past: rows.filter((w) => isPast(w.dateTime)).length,
  }), [rows]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((w) => {
      if (which === 'upcoming' && isPast(w.dateTime)) return false;
      if (which === 'past' && !isPast(w.dateTime)) return false;
      if (!needle) return true;
      return [w.cohortLabel, w.title, w.summary, w.pitch, w.slug]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(needle));
    });
  }, [rows, which, q]);

  const asked = rows.find((w) => w.id === askId) || null;

  async function activate(workshop) {
    if (!workshop || busy) return;
    setBusy(true);
    const result = await setWorkshopStatus(workshop.id, 'active');
    setBusy(false);
    if (result.error) {
      toast(result.error, 'warn');
      return;
    }
    setRows((list) => list.map((w) => (w.id === workshop.id ? { ...w, status: 'active' } : w)));
    toast(`${workshop.cohortLabel || workshop.title} is active.`, 'done');
  }

  async function deactivate() {
    if (!asked || busy) return;
    setBusy(true);
    const result = await setWorkshopStatus(asked.id, 'draft');
    setBusy(false);
    if (result.error) {
      setAskId('');
      toast(result.error, 'warn');
      return;
    }
    setRows((list) => list.map((w) => (w.id === asked.id ? { ...w, status: 'draft' } : w)));
    setAskId('');
    toast(`${asked.cohortLabel || asked.title} is a draft.`, 'done');
  }

  return (
    <SiteShell active="" toasts={toasts}>
      <div className={'wrap page-top ' + styles.page}>
        <AdminTabs current="workshops" />

        <header className={styles.head}>
          <div className={styles.picked}>
            <span className={styles.eyebrow}>Admin</span>
            <h1 className={styles.title}>Workshops</h1>
            <p className={styles.sub}>
              {counts.all} {counts.all === 1 ? 'workshop' : 'workshops'}
            </p>
          </div>
          <div className={styles.headActions}>
            <Link className="btn go" href="/admin/workshops/new">
              Add workshop
            </Link>
          </div>
        </header>

        <div className={styles.controls}>
          <input
            id="workshop-search"
            className={styles.search}
            type="search"
            placeholder="Search cohort or title"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search workshops"
          />
          <div className={styles.seg} role="group" aria-label="Filter workshops">
            {[
              ['all', 'All', counts.all],
              ['upcoming', 'Upcoming', counts.upcoming],
              ['past', 'Past', counts.past],
            ].map(([value, label, n]) => (
              <button
                key={value}
                type="button"
                className={styles.segBtn}
                aria-pressed={which === value}
                onClick={() => setWhich(value)}
              >
                {label}
                <span className={styles.segN}>{n}</span>
              </button>
            ))}
          </div>
        </div>

        {loadError ? (
          <div className={styles.empty}>
            <h2>The workshop list did not load.</h2>
            <p>{loadError}</p>
          </div>
        ) : shown.length === 0 ? (
          <div className={styles.empty}>
            <h2>{rows.length ? 'Nothing matches that.' : 'No workshops yet.'}</h2>
            <p>
              {rows.length
                ? 'Try a different search, or set the filter back to All.'
                : 'Add a workshop. It stays a draft until you activate it.'}
            </p>
          </div>
        ) : (
          <div className={styles.scroller}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Cohort</th>
                  <th scope="col">Title</th>
                  <th scope="col">When</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((w) => {
                  const past = isPast(w.dateTime);
                  return (
                    <tr key={w.id}>
                      <td className={styles.strong}>{w.cohortLabel || <span className={styles.faint}>—</span>}</td>
                      <td>
                        <Link className={local.titleLink} href={`/admin/workshops/${w.id}`} onClick={(e) => e.stopPropagation()}>
                          {w.title || 'Untitled'}
                        </Link>
                      </td>
                      <td>
                        {whenLabel(w.dateTime)}
                        <span className={local.when}>{past ? 'Past' : 'Upcoming'}</span>
                      </td>
                      <td>
                        {w.status === 'active' ? (
                          <button
                            type="button"
                            className={local.badge + ' ' + local.badgeLive}
                            disabled={busy}
                            onClick={() => setAskId(w.id)}
                          >
                            Active
                          </button>
                        ) : (
                          <button
                            type="button"
                            className={local.badge + ' ' + local.badgeDraft}
                            disabled={busy}
                            onClick={() => activate(w)}
                          >
                            Draft
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <p className={styles.foot}>
          Drafts stay off the public workshop list. This list is saved in the workshops table. The public pages are unchanged.
          <br />
          Signed in as {viewer} · visible to named addresses only.
        </p>
      </div>

      {asked && (
        <div className={local.backdrop} onClick={() => setAskId('')}>
          <div
            className={local.dialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="deactivate-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="deactivate-title">Deactivate this workshop?</h2>
            <p>Are you sure you want to deactivate this workshop?</p>
            <div className={local.dialogActions}>
              <button className="btn ghost" type="button" onClick={() => setAskId('')}>Keep</button>
              <button className={styles.danger + ' ' + local.yes} type="button" onClick={deactivate} disabled={busy}>Yes</button>
            </div>
          </div>
        </div>
      )}
    </SiteShell>
  );
}
