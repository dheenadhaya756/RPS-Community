'use client';
import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { CONFIG } from '@/lib/community/content';
import { seatUrl, initialsFrom } from '@/lib/community/workshops';
import { useSession, identityFrom, useStuck } from '@/lib/community/hooks';
import { clearClientState } from '@/lib/community/session-state';
import { currentUserIsAdmin } from '@/lib/admin-access';

/* The wordmark is the fallback. CONFIG.logoUrl takes over everywhere, nav and
   footer. Some marks (white line-art, no fill) only read against a dark chip —
   CONFIG.logoOnDark wraps it in one so it survives both themes. */
export function Logo() {
  const src = CONFIG.logoUrl;
  if (!src) {
    return (
      <Link className="logo" href="/">
        RPS <span>Cohorts</span>
      </Link>
    );
  }
  const img = <img className="logo-img" src={src} alt={CONFIG.siteName} />;
  return (
    <Link className="logo" href="/">
      {CONFIG.logoOnDark ? <span className="logo-badge">{img}</span> : img}
    </Link>
  );
}

export default function Nav({ active }) {
  const router = useRouter();
  const pathname = usePathname();
  const stuck = useStuck();
  const { user } = useSession();
  const me = identityFrom(user);

  const [menuOpen, setMenuOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const menuWrap = useRef(null);

  // Guests and ordinary accounts get false. Only a signed-in admin email
  // flips this, and the check happens on the server so the allow-list never
  // reaches the browser.
  useEffect(() => {
    if (!user) {
      setIsAdmin(false);
      return;
    }
    let alive = true;
    currentUserIsAdmin().then((yes) => {
      if (alive) setIsAdmin(!!yes);
    });
    return () => {
      alive = false;
    };
  }, [user]);

  useEffect(() => {
    const onDoc = (e) => {
      if (menuWrap.current && !menuWrap.current.contains(e.target)) setMenuOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setMenuOpen(false);
        setNavOpen(false);
      }
    };
    document.addEventListener('click', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  // Sign out goes through Supabase, exactly as the dashboard and workshop
  // pages already do — the middleware then handles the redirect on next nav.
  const onSignOut = async () => {
    const supabase = createClient();
    // scope 'global' so the refresh token dies server-side, not just the cookie
    // on this machine — otherwise "sign out" leaves a session that can be
    // resumed anywhere it was already open.
    await supabase.auth.signOut({ scope: 'global' });
    // Supabase clears its own cookie and knows nothing about ours. Everything
    // under `rps.` belongs to whoever just left: seats, the pending-auth flag,
    // the mid-enrolment snapshot. Leave it and the next person to log in on
    // this browser sees the previous user's workshop registrations.
    clearClientState();
    setMenuOpen(false);
    router.push('/');
    router.refresh();
  };

  const loginHref = `/signin?next=${encodeURIComponent(pathname || '/')}`;

  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <nav className={'nav' + (stuck ? ' stuck' : '')}>
        <div className="wrap nav-in">
          <Logo />
          <div className={'nav-links' + (navOpen ? ' open' : '')} id="navlinks">
            <Link href="/" aria-current={active === 'home' ? 'page' : undefined}>
              Home
            </Link>
            <Link href="/workshops" aria-current={active === 'workshops' ? 'page' : undefined}>
              Workshops
            </Link>
            {!me && !/^\/signin/.test(pathname || '') && <Link href={loginHref}>Log in</Link>}
          </div>

          <div className="nav-right">
            {/* <Link className="btn sm go" href={seatUrl()}>
              Grab a seat
            </Link> */}

            {me && (
              <div className="menu-wrap" ref={menuWrap}>
                <button
                  className="avatar"
                  type="button"
                  aria-haspopup="true"
                  aria-expanded={menuOpen}
                  aria-label={`Account menu for ${me.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpen((v) => !v);
                  }}
                >
                  {initialsFrom(me.name) || 'U'}
                </button>
                <div
                  className="dropdown"
                  role="menu"
                  data-open={String(menuOpen)}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="hd">
                    <b>{me.name}</b>
                    <small>{me.email}</small>
                  </div>
                  {isAdmin && (
                    <Link href="/admin/workshops" role="menuitem" onClick={() => setMenuOpen(false)}>
                      Admin
                    </Link>
                  )}
                  <Link href="/dashboard" role="menuitem" onClick={() => setMenuOpen(false)}>
                    My workshops
                  </Link>
                  <button type="button" role="menuitem" onClick={onSignOut}>
                    Sign out
                  </button>
                </div>
              </div>
            )}
          </div>

          <button
            className="nav-toggle"
            type="button"
            aria-expanded={navOpen}
            aria-controls="navlinks"
            aria-label="Menu"
            onClick={() => setNavOpen((v) => !v)}
          >
            <svg width="20" height="14" viewBox="0 0 20 14" aria-hidden="true">
              <path d="M0 1h20M0 7h20M0 13h20" stroke="currentColor" strokeWidth="2" />
            </svg>
          </button>
        </div>
      </nav>
    </>
  );
}
