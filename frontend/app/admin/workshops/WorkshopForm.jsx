'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import SiteShell from '@/components/community/SiteShell';
import { useToasts } from '@/lib/community/hooks';
import AdminTabs from '../AdminTabs';
import styles from '../registrations/registrations.module.css';
import local from './workshops.module.css';
import { slugify } from './seed';
import { checkWorkshopSlug, removeWorkshop, saveWorkshop, setWorkshopStatus } from './actions';

const STEPS = ['Basics', 'The session', 'People and room', 'After the session'];
const SAVED_TOAST = 'rps-admin-workshop-saved';
const REMOVED_TOAST = 'rps-admin-workshop-removed';

function alreadyHappened(iso) {
  if (!iso) return false;
  const when = new Date(iso);
  return !Number.isNaN(when.getTime()) && when.getTime() < Date.now();
}

function clean(list) {
  const kept = (list || []).map((s) => String(s).trim()).filter(Boolean);
  return kept.length ? kept : [''];
}

function toInput(iso) {
  const match = String(iso || '').match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})/);
  return match ? match[1] : '';
}

function fromInput(value) {
  if (!value) return '';
  return `${value}:00+05:30`;
}

function Lines({ label, items, onChange, multiline, addLabel, placeholder, confirmRemove }) {
  const [drop, setDrop] = useState(null);

  function removeAt(index) {
    onChange(items.filter((_, j) => j !== index));
    setDrop(null);
  }

  return (
    <div className={local.field}>
      <span className={local.legend}>{label}</span>
      <div className={local.lines}>
        {items.map((item, i) => (
          <div className={local.line} key={i}>
            {multiline ? (
              <textarea
                className={styles.mailBody}
                rows={4}
                value={item}
                placeholder={placeholder}
                onChange={(e) => {
                  const next = items.slice();
                  next[i] = e.target.value;
                  onChange(next);
                }}
              />
            ) : (
              <input
                className={styles.search}
                value={item}
                placeholder={placeholder}
                onChange={(e) => {
                  const next = items.slice();
                  next[i] = e.target.value;
                  onChange(next);
                }}
              />
            )}
            {items.length > 1 && (
              confirmRemove && drop === i ? (
                <span className={styles.confirm + ' ' + local.lineConfirm}>
                  <span className={styles.ask}>Remove?</span>
                  <span className={local.lineConfirmActs}>
                    <button className={styles.danger} type="button" onClick={() => removeAt(i)}>Yes</button>
                    <button className={styles.act} type="button" onClick={() => setDrop(null)}>Keep</button>
                  </span>
                </span>
              ) : (
                <button
                  className={styles.remove}
                  type="button"
                  onClick={() => (confirmRemove && String(item).trim() ? setDrop(i) : removeAt(i))}
                >
                  Remove
                </button>
              )
            )}
          </div>
        ))}
      </div>
      <button className={local.add} type="button" onClick={() => onChange([...items, ''])}>
        {addLabel}
      </button>
    </div>
  );
}

function Quotes({ items, onChange }) {
  const [drop, setDrop] = useState(null);

  function update(index, patch) {
    const next = items.slice();
    next[index] = { ...next[index], ...patch };
    onChange(next);
  }

  function removeAt(index) {
    onChange(items.filter((_, j) => j !== index));
    setDrop(null);
  }

  function blank(item) {
    return !String(item.quote || '').trim() && !String(item.name || '').trim() && !String(item.role || '').trim();
  }

  return (
    <div className={local.field}>
      <span className={local.legend}>Testimonials</span>
      <p className={local.quoteHint}>Quotes from people who were in this session. Leave this empty while the workshop is still upcoming.</p>
      <div className={local.quotes}>
        {items.map((item, i) => (
          <div className={local.quote} key={item.id || i}>
            <label htmlFor={`quote-${i}`}>Quote</label>
            <textarea
              id={`quote-${i}`}
              className={styles.mailBody}
              rows={3}
              value={item.quote}
              placeholder="What they said"
              onChange={(e) => update(i, { quote: e.target.value })}
            />
            <div className={local.pairWide + ' admin-form-pair-wide'}>
              <div className={local.field}>
                <label htmlFor={`quote-name-${i}`}>Name</label>
                <input id={`quote-name-${i}`} className={styles.search} value={item.name} onChange={(e) => update(i, { name: e.target.value })} />
              </div>
              <div className={local.field}>
                <label htmlFor={`quote-role-${i}`}>Role</label>
                <input id={`quote-role-${i}`} className={styles.search} value={item.role} placeholder="Working professional · Cohort 02" onChange={(e) => update(i, { role: e.target.value })} />
              </div>
            </div>
            <div className={local.quoteFoot}>
              <label className={local.featured}>
                <input type="checkbox" checked={!!item.featured} onChange={(e) => update(i, { featured: e.target.checked })} />
                Featured
              </label>
              {drop === i ? (
                <span className={styles.confirm + ' ' + local.lineConfirm}>
                  <span className={styles.ask}>Remove?</span>
                  <span className={local.lineConfirmActs}>
                    <button className={styles.danger} type="button" onClick={() => removeAt(i)}>Yes</button>
                    <button className={styles.act} type="button" onClick={() => setDrop(null)}>Keep</button>
                  </span>
                </span>
              ) : (
                <button className={styles.remove} type="button" onClick={() => (blank(item) ? removeAt(i) : setDrop(i))}>
                  Remove
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      <button
        className={local.add}
        type="button"
        onClick={() => onChange([...items, { id: `t_${Date.now()}`, name: '', role: '', quote: '', featured: false }])}
      >
        Add a testimonial
      </button>
    </div>
  );
}

const IMAGE_MAX = 1024 * 1024;

function Picture({ id, label, url, error, onPick, onError }) {
  return (
    <div className={local.field}>
      <label htmlFor={id}>{label}</label>
      <div className={local.fileRow}>
        {url ? <img className={local.shot} src={url} alt="" /> : <span className={local.shotEmpty} />}
        <input
          id={id}
          className={local.file}
          type="file"
          accept="image/*"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            if (!file.type.startsWith('image/')) {
              e.target.value = '';
              onError('Choose an image file.');
              return;
            }
            if (file.size >= IMAGE_MAX) {
              e.target.value = '';
              onError(`${label} must be under 1 MB.`);
              return;
            }
            onError('');
            onPick(file, URL.createObjectURL(file));
          }}
        />
      </div>
      <p className={local.hint}>Under 1 MB.</p>
      {error && <p id={`${id}-error`} className={local.fieldErr} role="alert">{error}</p>}
    </div>
  );
}

export default function WorkshopForm({ viewer, workshopId, initial, hosts }) {
  const router = useRouter();
  const { toasts, toast } = useToasts();
  const files = useRef({ banner: null, email: null, notes: null });
  const [record, setRecord] = useState(initial);
  const [step, setStep] = useState(0);
  const [slugTouched, setSlugTouched] = useState(workshopId !== 'new');
  const [slugError, setSlugError] = useState('');
  const [slugChecking, setSlugChecking] = useState(false);
  const slugCheck = useRef(0);
  const slugValue = useRef(initial.slug || '');
  const [error, setError] = useState('');
  const [ask, setAsk] = useState(false);
  const [askRemove, setAskRemove] = useState(false);
  const [dropHost, setDropHost] = useState(null);
  const [saving, setSaving] = useState(false);
  const [imageErrors, setImageErrors] = useState({ banner: '', email: '' });

  useEffect(() => {
    const message = sessionStorage.getItem(SAVED_TOAST);
    if (!message) return;
    sessionStorage.removeItem(SAVED_TOAST);
    toast(message, 'done');
  }, [toast]);

  function set(key) {
    return (e) => {
      const value = e.target.value;
      setRecord((current) => {
        const next = { ...current, [key]: value };
        if (key === 'title' && !slugTouched) next.slug = slugify(value);
        if (key === 'slug' || (key === 'title' && !slugTouched)) slugValue.current = next.slug;
        return next;
      });
      if (key === 'slug' || (key === 'title' && !slugTouched)) {
        setSlugError('');
        setSlugChecking(false);
      }
    };
  }

  async function leaveSlug(raw) {
    const clean = slugify(raw);
    slugValue.current = clean;
    setRecord((current) => ({ ...current, slug: clean }));
    if (!clean) {
      setSlugError('');
      setSlugChecking(false);
      return;
    }
    const ticket = ++slugCheck.current;
    setSlugError('');
    setSlugChecking(true);
    const res = await checkWorkshopSlug(clean, workshopId === 'new' ? '' : workshopId);
    if (ticket !== slugCheck.current || slugValue.current !== clean) return;
    setSlugChecking(false);
    if (res.error) {
      setSlugError('Could not check that page address. Try again.');
      return;
    }
    setSlugError(res.taken ? 'This page address is already used. Use a different one.' : '');
  }

  function keepPreview(current, next) {
    if (String(current || '').startsWith('blob:') && current !== next) URL.revokeObjectURL(current);
  }

  async function persist(status) {
    if (saving) return;
    const title = record.title.trim();
    if (title.length < 2) {
      setError('Add a title before saving.');
      setStep(0);
      return;
    }
    const slug = slugify(record.slug) || slugify(title);
    slugValue.current = slug;
    setRecord((current) => ({ ...current, slug }));
    const payload = {
      ...record,
      title,
      slug,
      status,
      durationMins: Number(record.durationMins) || 120,
      description: clean(record.description),
      whoItsFor: clean(record.whoItsFor),
      curriculum: clean(record.curriculum),
      recap: clean(record.recap),
      testimonials: (record.testimonials || [])
        .map((t) => ({
          name: String(t.name || '').trim(),
          role: String(t.role || '').trim(),
          quote: String(t.quote || '').trim(),
          featured: !!t.featured,
        }))
        .filter((t) => t.quote || t.name || t.role),
    };
    const tooLarge =
      files.current.banner && files.current.banner.size >= IMAGE_MAX
        ? 'Picture must be under 1 MB.'
        : files.current.email && files.current.email.size >= IMAGE_MAX
          ? 'Small email picture must be under 1 MB.'
          : files.current.notes && files.current.notes.size > 20 * 1024 * 1024
            ? 'The PDF must be under 20 MB.'
            : '';
    if (tooLarge) {
      setError(tooLarge);
      toast(tooLarge, 'warn');
      if (/Picture must be under/.test(tooLarge)) setImageErrors((c) => ({ ...c, banner: tooLarge }));
      if (/Small email picture/.test(tooLarge)) setImageErrors((c) => ({ ...c, email: tooLarge }));
      setStep(/PDF/.test(tooLarge) ? 3 : 0);
      return;
    }

    const body = new FormData();
    body.set('workshop', JSON.stringify(payload));
    if (files.current.banner) body.set('banner', files.current.banner);
    if (files.current.email) body.set('emailBanner', files.current.email);
    if (files.current.notes) body.set('notes', files.current.notes);

    setSaving(true);
    setError('');
    let result;
    try {
      result = await saveWorkshop(body);
    } catch (err) {
      setSaving(false);
      const message = /body exceeded/i.test(String(err && err.message))
        ? 'That upload is too large. Pictures must be under 1 MB, and the PDF under 20 MB.'
        : 'Could not save. Try again.';
      setError(message);
      toast(message, 'warn');
      return;
    }
    setSaving(false);
    if (result.error) {
      setAsk(false);
      setError(result.error);
      toast(result.error, 'warn');
      if (/Picture must be under/.test(result.error)) {
        setImageErrors((c) => ({ ...c, banner: result.error }));
        setStep(0);
      }
      if (/Small email picture/.test(result.error)) {
        setImageErrors((c) => ({ ...c, email: result.error }));
        setStep(0);
      }
      if (/PDF/.test(result.error)) setStep(3);
      if (/title/.test(result.error)) setStep(0);
      if (/page address/i.test(result.error)) {
        setStep(0);
        setSlugError('This page address is already used. Use a different one.');
      }
      return;
    }
    keepPreview(record.bannerUrl, result.workshop?.bannerUrl);
    keepPreview(record.emailBannerUrl, result.workshop?.emailBannerUrl);
    keepPreview(record.notesFileUrl, result.workshop?.notesFileUrl);
    files.current = { banner: null, email: null, notes: null };
    setRecord(result.workshop || payload);
    setAsk(false);
    const message = status === 'active' ? 'Saved as active.' : 'Saved as a draft.';
    if (workshopId === 'new' && result.workshop?.id) {
      sessionStorage.setItem(SAVED_TOAST, message);
      router.replace(`/admin/workshops/${result.workshop.id}`);
    } else {
      toast(message, 'done');
      router.refresh();
    }
  }

  async function makeDraft() {
    if (saving || !record.id) return;
    setSaving(true);
    const result = await setWorkshopStatus(record.id, 'draft');
    setSaving(false);
    setAsk(false);
    if (result.error) {
      toast(result.error, 'warn');
      return;
    }
    setRecord((current) => ({ ...current, status: 'draft' }));
    toast('This workshop is a draft.', 'done');
    router.refresh();
  }

  async function removeThis() {
    if (saving || workshopId === 'new') return;
    setSaving(true);
    setError('');
    const result = await removeWorkshop(workshopId);
    setSaving(false);
    if (result.error) {
      setAskRemove(false);
      setError(result.error);
      toast(result.error, 'warn');
      return;
    }
    const name = record.cohortLabel || record.title || 'Workshop';
    sessionStorage.setItem(REMOVED_TOAST, `${name} removed.`);
    router.push('/admin/workshops');
  }

  const chosen = record.hostIds.map((id) => hosts.find((h) => h.id === id)).filter(Boolean);
  const available = hosts.filter((h) => !record.hostIds.includes(h.id));

  return (
    <SiteShell active="" toasts={toasts}>
      <div className={'wrap page-top ' + styles.page}>
        <AdminTabs current="workshops" />

        <header className={styles.head}>
          <div className={styles.picked}>
            <span className={styles.eyebrow}>Admin</span>
            <h1 className={styles.title}>{workshopId === 'new' ? 'New workshop' : (record.cohortLabel || 'Workshop')}</h1>
            <p className={styles.sub}>
              <Link href="/admin/workshops">All workshops</Link>
              {' · '}
              {record.status === 'active' ? 'Active' : 'Draft'}
            </p>
          </div>
          <div className={styles.headActions}>
            {record.status === 'active' ? (
              <button className="btn ghost" type="button" onClick={() => setAsk(true)}>Deactivate</button>
            ) : (
              <button className="btn go" type="button" onClick={() => persist('active')} disabled={saving}>Activate</button>
            )}
          </div>
        </header>

          <>
          <div className={local.layout + ' admin-form-layout'}>
            <div className={local.steps + ' admin-form-steps'} role="tablist" aria-label="Workshop form steps">
              {STEPS.map((label, i) => (
                <button
                  key={label}
                  className={local.step}
                  type="button"
                  role="tab"
                  aria-selected={step === i}
                  aria-current={step === i ? 'step' : undefined}
                  onClick={() => setStep(i)}
                >
                  {i + 1}. {label}
                </button>
              ))}
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                persist(record.status === 'active' ? 'active' : 'draft');
              }}
            >
              {step === 0 && (
                <div className={local.panel}>
                  <div className={local.pairWide + ' admin-form-pair-wide'}>
                    <div className={local.field}>
                      <label htmlFor="cohort">Cohort name</label>
                      <input id="cohort" className={styles.search} value={record.cohortLabel} onChange={set('cohortLabel')} placeholder="Cohort 04" />
                    </div>
                    <div className={local.field}>
                      <label htmlFor="slug">Page address</label>
                      <div className={local.slugBox}>
                        <input
                          id="slug"
                          className={styles.search + (slugChecking ? ' ' + local.slugBusy : '') + (slugError ? ' ' + local.slugBad : '')}
                          value={record.slug}
                          aria-invalid={slugError ? true : undefined}
                          aria-busy={slugChecking || undefined}
                          aria-describedby={slugError ? 'slug-error' : undefined}
                          onChange={(e) => {
                            setSlugTouched(true);
                            set('slug')(e);
                          }}
                          onBlur={(e) => leaveSlug(e.target.value)}
                          placeholder="shortlist-ready-portfolio"
                        />
                        {slugChecking && <span className={local.slugSpin} aria-hidden="true" />}
                      </div>
                      {slugError && <p id="slug-error" className={local.slugHint}>{slugError}</p>}
                    </div>
                  </div>
                  <div className={local.field}>
                    <label htmlFor="title">Title</label>
                    <input id="title" className={styles.search} value={record.title} onChange={set('title')} />
                  </div>
                  <div className={local.field}>
                    <label htmlFor="summary">Short summary</label>
                    <textarea id="summary" className={styles.mailBody} rows={3} value={record.summary} onChange={set('summary')} />
                  </div>
                  <div className={local.pair + ' admin-form-pair'}>
                    <div className={local.field}>
                      <label htmlFor="when">Date and time</label>
                      <input id="when" className={styles.search} type="datetime-local" value={toInput(record.dateTime)} onChange={(e) => setRecord((c) => ({ ...c, dateTime: fromInput(e.target.value) }))} />
                      <p className={local.hint}>India time.</p>
                    </div>
                    <div className={local.field}>
                      <label htmlFor="length">Length (minutes)</label>
                      <input id="length" className={styles.search} inputMode="numeric" value={record.durationMins} onChange={set('durationMins')} />
                    </div>
                  </div>
                  <Picture
                    id="banner"
                    label="Picture"
                    url={record.bannerUrl}
                    error={imageErrors.banner}
                    onError={(message) => setImageErrors((c) => ({ ...c, banner: message }))}
                    onPick={(file, url) => {
                      files.current.banner = file;
                      setRecord((c) => {
                        keepPreview(c.bannerUrl, url);
                        return { ...c, bannerUrl: url };
                      });
                    }}
                  />
                  <Picture
                    id="email-banner"
                    label="Small email picture"
                    url={record.emailBannerUrl}
                    error={imageErrors.email}
                    onError={(message) => setImageErrors((c) => ({ ...c, email: message }))}
                    onPick={(file, url) => {
                      files.current.email = file;
                      setRecord((c) => {
                        keepPreview(c.emailBannerUrl, url);
                        return { ...c, emailBannerUrl: url };
                      });
                    }}
                  />
                </div>
              )}

              {step === 1 && (
                <div className={local.panel}>
                  <div className={local.field}>
                    <label htmlFor="pitch">Pitch</label>
                    <input id="pitch" className={styles.search} value={record.pitch} onChange={set('pitch')} />
                  </div>
                  <Lines
                    label="Full description"
                    items={record.description}
                    onChange={(description) => setRecord((c) => ({ ...c, description }))}
                    multiline
                    confirmRemove
                    addLabel="Add paragraph"
                    placeholder="One paragraph"
                  />
                  <Lines
                    label="Who it is for"
                    items={record.whoItsFor}
                    onChange={(whoItsFor) => setRecord((c) => ({ ...c, whoItsFor }))}
                    confirmRemove
                    addLabel="Add a line"
                  />
                  <div className={local.field}>
                    <label htmlFor="curriculum-title">What’s in it for you — title</label>
                    <input id="curriculum-title" className={styles.search} value={record.curriculumTitle} onChange={set('curriculumTitle')} />
                  </div>
                  <Lines
                    label="What’s in it for you"
                    items={record.curriculum}
                    onChange={(curriculum) => setRecord((c) => ({ ...c, curriculum }))}
                    confirmRemove
                    addLabel="Add a line"
                  />
                </div>
              )}

              {step === 2 && (
                <div className={local.panel}>
                  <div className={local.field}>
                    <label htmlFor="host-pick">Hosts</label>
                    <select
                      id="host-pick"
                      className={styles.search}
                      value=""
                      onChange={(e) => {
                        const id = e.target.value;
                        if (!id) return;
                        setRecord((c) => ({ ...c, hostIds: [...c.hostIds, id] }));
                      }}
                    >
                      <option value="">{hosts.length ? (available.length ? 'Add a host' : 'All hosts are added') : 'No hosts yet'}</option>
                      {available.map((h) => (
                        <option key={h.id} value={h.id}>{h.name}{h.role ? ` — ${h.role}` : ''}</option>
                      ))}
                    </select>
                    {chosen.length > 0 && (
                      <ul className={local.chosen}>
                        {chosen.map((h) => (
                          <li key={h.id}>
                            <span>{h.name}{h.role ? ` — ${h.role}` : ''}</span>
                            {dropHost === h.id ? (
                              <span className={styles.confirm + ' ' + local.lineConfirm}>
                                <span className={styles.ask}>Remove?</span>
                                <span className={local.lineConfirmActs}>
                                  <button
                                    className={styles.danger}
                                    type="button"
                                    onClick={() => {
                                      setRecord((c) => ({ ...c, hostIds: c.hostIds.filter((id) => id !== h.id) }));
                                      setDropHost(null);
                                    }}
                                  >
                                    Yes
                                  </button>
                                  <button className={styles.act} type="button" onClick={() => setDropHost(null)}>Keep</button>
                                </span>
                              </span>
                            ) : (
                              <button className={styles.remove} type="button" onClick={() => setDropHost(h.id)}>
                                Remove
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className={local.field}>
                    <label htmlFor="meet">Google Meet link</label>
                    <input id="meet" className={styles.search} value={record.meetLink} onChange={set('meetLink')} placeholder="https://meet.google.com/…" />
                  </div>
                  <div className={local.pair + ' admin-form-pair'}>
                    <div className={local.field}>
                      <label htmlFor="dial">Phone dial-in <span className={local.opt}>optional</span></label>
                      <input id="dial" className={styles.search} value={record.dialNumber} onChange={set('dialNumber')} placeholder="+1 470-268-2152" />
                    </div>
                    <div className={local.field}>
                      <label htmlFor="pin">Pin <span className={local.opt}>optional</span></label>
                      <input id="pin" className={styles.search} value={record.dialPin} onChange={set('dialPin')} placeholder="411 984 325#" />
                    </div>
                  </div>
                  <p className={local.hint}>Leave the dial-in empty if there isn’t one.</p>
                 {/*  <p className={local.cap}>45 seats. Shown on the page. It does not stop anyone from signing up.</p> */}
                </div>
              )}

              {step === 3 && (
                <div className={local.panel}>
                  <div className={local.field}>
                    <label htmlFor="youtube">YouTube link</label>
                    <input id="youtube" className={styles.search} value={record.recordingUrl} onChange={set('recordingUrl')} placeholder="https://youtu.be/…" />
                  </div>
                  <div className={local.field}>
                    <label htmlFor="notes-title">PDF notes — title</label>
                    <input id="notes-title" className={styles.search} value={record.notesTitle} onChange={set('notesTitle')} />
                  </div>
                  <div className={local.field}>
                    <label htmlFor="notes-desc">One-line description</label>
                    <input id="notes-desc" className={styles.search} value={record.notesDescription} onChange={set('notesDescription')} />
                  </div>
                  <div className={local.field}>
                    <label htmlFor="notes-file">PDF file</label>
                    <input
                      id="notes-file"
                      className={local.file}
                      type="file"
                      accept="application/pdf"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const url = URL.createObjectURL(file);
                        files.current.notes = file;
                        setRecord((c) => {
                          keepPreview(c.notesFileUrl, url);
                          return { ...c, notesFileName: file.name, notesFileUrl: url, notesPages: '', notesSize: '' };
                        });
                      }}
                    />
                    {record.notesFileName && (
                      <p className={local.fileMeta}>
                        <span>{record.notesFileName}</span>
                        {record.notesFileUrl && (
                          <a
                            className={local.eye}
                            href={record.notesFileUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={`Open ${record.notesFileName}`}
                          >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
                              <circle cx="12" cy="12" r="3" />
                            </svg>
                          </a>
                        )}
                      </p>
                    )}
                    {(record.notesPages || record.notesSize) && (
                      <p className={local.hint}>
                        {[record.notesPages && `${record.notesPages} pages`, record.notesSize].filter(Boolean).join(' · ')}
                      </p>
                    )}
                  </div>
                  <Lines
                    label="What happened in the room"
                    items={record.recap}
                    onChange={(recap) => setRecord((c) => ({ ...c, recap }))}
                    multiline
                    addLabel="Add paragraph"
                    placeholder="Leave this empty while the workshop is still upcoming"
                  />
                  <Quotes
                    items={record.testimonials || []}
                    onChange={(testimonials) => setRecord((c) => ({ ...c, testimonials }))}
                  />
                </div>
              )}

              {error && <p className={local.err} role="alert">{error}</p>}

              {/* {workshopId !== 'new' && (
                alreadyHappened(initial.dateTime) ? (
                  <p className={local.lockedNote}>This workshop has already happened, so it cannot be removed.</p>
                ) : (
                  <div className={local.removeRow}>
                    <button className={styles.remove} type="button" onClick={() => setAskRemove(true)} disabled={saving}>
                      Remove workshop
                    </button>
                  </div>
                )
              )} */}

              <div className={local.nav + ' admin-form-actions'}>
                <button className={'btn ghost ' + local.stepBtn + ' admin-form-stepbtn'} type="button" onClick={() => setStep((n) => Math.max(0, n - 1))} disabled={step === 0}>
                  Back
                </button>
                {step < STEPS.length - 1 && (
                  <button className={'btn go ' + local.stepBtn + ' admin-form-stepbtn'} type="button" onClick={() => setStep((n) => n + 1)}>
                    Next
                  </button>
                )}
                <button className={'btn ghost ' + local.saveBtn + ' admin-form-save'} type="submit" disabled={saving}>
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          </div>

            <p className={styles.foot}>
              Saving writes to the workshops table. Removing a workshop also deletes its pictures and PDF. A workshop that has already happened cannot be removed.
              <br />
              Signed in as {viewer} · visible to named addresses only.
            </p>
          </>
      </div>

      {ask && (
        <div className={local.backdrop} onClick={() => setAsk(false)}>
          <div
            className={local.dialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="deactivate-form-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="deactivate-form-title">Deactivate this workshop?</h2>
            <p>Are you sure you want to deactivate this workshop?</p>
            <div className={local.dialogActions}>
              <button className="btn ghost" type="button" onClick={() => setAsk(false)}>Keep</button>
              <button className={styles.danger + ' ' + local.yes} type="button" onClick={makeDraft} disabled={saving}>Yes</button>
            </div>
          </div>
        </div>
      )}

      {askRemove && (
        <div className={local.backdrop} onClick={() => !saving && setAskRemove(false)}>
          <div
            className={local.dialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="remove-workshop-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="remove-workshop-title">Remove this workshop?</h2>
            <p>Its pictures and notes PDF are deleted too. Anyone registered for it is taken off the list. This cannot be undone.</p>
            <div className={local.dialogActions}>
              <button className="btn ghost" type="button" onClick={() => setAskRemove(false)} disabled={saving}>Keep</button>
              <button className={styles.danger + ' ' + local.yes} type="button" onClick={removeThis} disabled={saving}>
                {saving ? 'Removing…' : 'Remove'}
              </button>
            </div>
          </div>
        </div>
      )}
    </SiteShell>
  );
}
