'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import SiteShell from '@/components/community/SiteShell';
import { useToasts } from '@/lib/community/hooks';
import AdminTabs from '../AdminTabs';
import styles from '../registrations/registrations.module.css';
import hostStyles from './hosts.module.css';
import { removeHost, saveHost } from './actions';

const PHOTO_MAX = 250 * 1024;
const PORTRAIT_MAX = 512 * 1024;

const EMPTY = {
  name: '',
  title: '',
  bio: '',
  role: '',
  years: '',
  photoUrl: '',
  portraitUrl: '',
};

function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function Face({ host }) {
  const [broken, setBroken] = useState(false);
  if (!host.photoUrl || broken) {
    return <span className={hostStyles.faceFallback}>{initials(host.name)}</span>;
  }
  return (
    <img
      className={hostStyles.face}
      src={host.photoUrl}
      alt=""
      onError={() => setBroken(true)}
    />
  );
}

export default function HostsClient({ viewer, initialHosts, loadError }) {
  const router = useRouter();
  const { toasts, toast } = useToasts();
  const [hosts, setHosts] = useState(initialHosts);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [files, setFiles] = useState({ photoUrl: null, portraitUrl: null });
  const [error, setError] = useState('');
  const [fileErrors, setFileErrors] = useState({ photoUrl: '', portraitUrl: '' });
  const [askRemove, setAskRemove] = useState(false);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const titleId = useId();
  const firstField = useRef(null);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return hosts;
    return hosts.filter((h) =>
      [h.name, h.title, h.role, h.bio].some((v) => String(v || '').toLowerCase().includes(needle))
    );
  }, [hosts, q]);

  useEffect(() => {
    setHosts(initialHosts);
  }, [initialHosts]);

  useEffect(() => {
    if (!editing) return;
    firstField.current?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [editing]);

  function openNew() {
    setForm(EMPTY);
    setFiles({ photoUrl: null, portraitUrl: null });
    setError('');
    setFileErrors({ photoUrl: '', portraitUrl: '' });
    setAskRemove(false);
    setNotice('');
    setEditing({ mode: 'new' });
  }

  function openEdit(host) {
    setForm({
      name: host.name,
      title: host.title,
      bio: host.bio,
      role: host.role,
      years: host.years === '' || host.years == null ? '' : String(host.years),
      photoUrl: host.photoUrl,
      portraitUrl: host.portraitUrl,
    });
    setFiles({ photoUrl: null, portraitUrl: null });
    setError('');
    setFileErrors({ photoUrl: '', portraitUrl: '' });
    setAskRemove(false);
    setNotice('');
    setEditing({ mode: 'edit', id: host.id });
  }

  function close() {
    setEditing(null);
    setAskRemove(false);
    setError('');
    setFiles({ photoUrl: null, portraitUrl: null });
    setFileErrors({ photoUrl: '', portraitUrl: '' });
  }

  function set(key) {
    return (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  }

  function pickImage(key, maxBytes, label) {
    return (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (!file.type.startsWith('image/')) {
        setFileErrors((current) => ({ ...current, [key]: 'Choose an image file.' }));
        e.target.value = '';
        return;
      }
      if (file.size >= maxBytes) {
        const kb = Math.round(maxBytes / 1024);
        setFileErrors((current) => ({ ...current, [key]: `${label} must be under ${kb} KB.` }));
        e.target.value = '';
        return;
      }
      const url = URL.createObjectURL(file);
      setFileErrors((current) => ({ ...current, [key]: '' }));
      setFiles((current) => ({ ...current, [key]: file }));
      setForm((f) => {
        if (String(f[key]).startsWith('blob:')) URL.revokeObjectURL(f[key]);
        return { ...f, [key]: url };
      });
    };
  }

  async function save(e) {
    e.preventDefault();
    const name = form.name.trim();
    if (name.length < 2) {
      setError('Add the host’s name.');
      return;
    }
    const years = String(form.years).trim();
    if (years && !/^\d{1,2}$/.test(years)) {
      setError('Years should be a number, like 13.');
      return;
    }
    const body = new FormData();
    if (editing.mode === 'edit') body.set('id', editing.id);
    body.set('name', name);
    body.set('title', form.title.trim());
    body.set('bio', form.bio.trim());
    body.set('role', form.role.trim());
    body.set('years', years);
    if (files.photoUrl) body.set('photo', files.photoUrl);
    if (files.portraitUrl) body.set('portrait', files.portraitUrl);

    setBusy(true);
    setError('');
    const result = await saveHost(body);
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    toast(editing.mode === 'new' ? `${name} added.` : `${name} updated.`, 'done');
    close();
    router.refresh();
  }

  async function remove() {
    const current = hosts.find((h) => h.id === editing.id);
    setBusy(true);
    setError('');
    const result = await removeHost(editing.id);
    setBusy(false);
    if (result.error) {
      setError(result.error);
      setAskRemove(false);
      return;
    }
    setNotice(`${current?.name || 'Host'} removed.`);
    close();
    router.refresh();
  }

  return (
    <SiteShell active="" toasts={toasts}>
      <div className={'wrap page-top ' + styles.page}>
        <AdminTabs current="hosts" />

        <header className={styles.head}>
          <div className={styles.picked}>
            <span className={styles.eyebrow}>Admin</span>
            <h1 className={styles.title}>Hosts</h1>
            <p className={styles.sub}>
              {hosts.length} {hosts.length === 1 ? 'host' : 'hosts'}
            </p>
          </div>
          <div className={styles.headActions}>
            <button className="btn go" type="button" onClick={openNew}>
              Add host
            </button>
          </div>
        </header>

        {notice && <div className={styles.note2} role="status">{notice}</div>}

        <div className={styles.controls}>
          <input
            className={styles.search}
            type="search"
            placeholder="Search name, role or title"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search hosts"
          />
        </div>

        {loadError ? (
          <div className={styles.empty}>
            <h2>The host list did not load.</h2>
            <p>{loadError}</p>
          </div>
        ) : shown.length === 0 ? (
          <div className={styles.empty}>
            <h2>{hosts.length ? 'Nothing matches that.' : 'No hosts yet.'}</h2>
            <p>
              {hosts.length
                ? 'Try a different search.'
                : 'Add a host and they can be picked on a workshop.'}
            </p>
          </div>
        ) : (
          <div className={styles.scroller}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col"><span className={styles.sr}>Photo</span></th>
                  <th scope="col">Name</th>
                  <th scope="col">Role</th>
                  <th scope="col">Years</th>
                  <th scope="col">Title</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((h) => (
                  <tr key={h.id} className={hostStyles.clickRow} onClick={() => openEdit(h)}>
                    <td><Face host={h} /></td>
                    <td>
                      <button type="button" className={hostStyles.rowBtn} onClick={() => openEdit(h)}>
                        {h.name}
                      </button>
                    </td>
                    <td>{h.role || <span className={styles.faint}>&mdash;</span>}</td>
                    <td className={styles.num}>
                      {h.years === '' || h.years == null ? <span className={styles.faint}>&mdash;</span> : h.years}
                    </td>
                    <td>{h.title || <span className={styles.faint}>&mdash;</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className={styles.foot}>
          Add, edit, and remove are saved in the hosts table. Removing a host also deletes its pictures.
          <br />
          Signed in as {viewer} · visible to named addresses only.
        </p>
      </div>

      {editing && (
        <div className={hostStyles.backdrop} onClick={close}>
          <div
            className={hostStyles.dialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id={titleId}>{editing.mode === 'new' ? 'Add host' : 'Edit host'}</h2>
            <p className={hostStyles.dialogLead}>
              These are the details the workshop page shows for a host.
            </p>
            <form onSubmit={save}>
              <div className={hostStyles.fields}>
                <div className={hostStyles.field}>
                  <label htmlFor="host-name">Name</label>
                  <input
                    ref={firstField}
                    id="host-name"
                    className={styles.search}
                    value={form.name}
                    onChange={set('name')}
                    autoComplete="name"
                  />
                </div>
                <div className={hostStyles.pair}>
                  <div className={hostStyles.field}>
                    <label htmlFor="host-role">Role</label>
                    <input id="host-role" className={styles.search} value={form.role} onChange={set('role')} placeholder="Principal Designer" />
                  </div>
                  <div className={hostStyles.field}>
                    <label htmlFor="host-years">Years</label>
                    <input id="host-years" className={styles.search} inputMode="numeric" value={form.years} onChange={set('years')} placeholder="13" />
                  </div>
                </div>
                <div className={hostStyles.field}>
                  <label htmlFor="host-title">Job title</label>
                  <input id="host-title" className={styles.search} value={form.title} onChange={set('title')} placeholder="Principal Designer and Manager, RPS" />
                </div>
                <div className={hostStyles.field}>
                  <label htmlFor="host-bio">Short bio</label>
                  <textarea id="host-bio" className={styles.mailBody} rows={4} value={form.bio} onChange={set('bio')} />
                </div>
                <div className={hostStyles.field}>
                  <label htmlFor="host-photo">Small photo</label>
                  <div className={hostStyles.fileRow}>
                    {form.photoUrl
                      ? <img className={hostStyles.thumb} src={form.photoUrl} alt="" />
                      : <span className={hostStyles.thumbEmpty} />}
                    <input
                      id="host-photo"
                      className={hostStyles.file}
                      type="file"
                      accept="image/*"
                      onChange={pickImage('photoUrl', PHOTO_MAX, 'Small photo')}
                    />
                  </div>
                  <p className={hostStyles.hint}>Under 250 KB.</p>
                  {fileErrors.photoUrl && (
                    <p className={hostStyles.fieldErr} role="alert">{fileErrors.photoUrl}</p>
                  )}
                </div>
                <div className={hostStyles.field}>
                  <label htmlFor="host-portrait">Larger portrait</label>
                  <div className={hostStyles.fileRow}>
                    {form.portraitUrl
                      ? <img className={hostStyles.portrait} src={form.portraitUrl} alt="" />
                      : <span className={hostStyles.portraitEmpty} />}
                    <input
                      id="host-portrait"
                      className={hostStyles.file}
                      type="file"
                      accept="image/*"
                      onChange={pickImage('portraitUrl', PORTRAIT_MAX, 'Larger portrait')}
                    />
                  </div>
                  <p className={hostStyles.hint}>Under 512 KB.</p>
                  {fileErrors.portraitUrl && (
                    <p className={hostStyles.fieldErr} role="alert">{fileErrors.portraitUrl}</p>
                  )}
                </div>
                {error && <p className={hostStyles.err} role="alert">{error}</p>}
              </div>
              <div className={hostStyles.actions}>
                {editing.mode === 'edit' && !askRemove && (
                  <button className={styles.remove} type="button" onClick={() => setAskRemove(true)}>
                    Remove
                  </button>
                )}
                {editing.mode === 'edit' && askRemove && (
                  <span className={styles.confirm}>
                    <span className={styles.ask}>Remove this host?</span>
                    <button className={styles.danger} type="button" onClick={remove} disabled={busy}>Yes</button>
                    <button className={styles.act} type="button" onClick={() => setAskRemove(false)} disabled={busy}>Keep</button>
                  </span>
                )}
                <span className={hostStyles.spacer} />
                <button className="btn ghost" type="button" onClick={close} disabled={busy}>Cancel</button>
                <button className="btn go" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </SiteShell>
  );
}
