'use client';
import React from 'react';
import Link from 'next/link';
import { CONFIG } from '@/lib/community/content';
import { useSession } from '@/lib/community/hooks';
import { Logo } from './Nav';

export default function Footer() {
  const { user } = useSession();

  return (
    <footer className="site">
      <div className="wrap in">
        <div className="cols">
          <div>
            <Logo />
            <p className="tagline">Free, and staying free.</p>
            <p className="micro" style={{ maxWidth: '32ch', marginTop: 14 }}>
              {CONFIG.footerTagline}
            </p>
          </div>
          <div>
            <h4>Workshops</h4>
            <div className="links">
              <Link href="/workshops#upcoming">Upcoming</Link>
              <Link href="/workshops#past">Past &amp; recordings</Link>
              <Link href="/review">Portfolio review</Link>
            </div>
          </div>
          <div>
            <h4>Account</h4>
            <div className="links">
              {!user && <Link href="/signin">Log in</Link>}
              <Link href="/dashboard">My workshops</Link>
              <a href={CONFIG.whatsappUrl} target="_blank" rel="noopener noreferrer">
                WhatsApp group
              </a>
            </div>
          </div>
          <div>
            <h4>RPS</h4>
            <div className="links">
              <a href={CONFIG.aboutRpsUrl} target="_blank" rel="noopener noreferrer">
                About RPS
              </a>
              <a href={CONFIG.sayHiUrl}>Say hi</a>
            </div>
          </div>
          <div>
            <h4>Legal</h4>
            <div className="links">
              <Link href="/terms">Terms &amp; conditions</Link>
              <Link href="/privacy">Privacy policy</Link>
              <Link href="/privacy#cookies">Cookie policy</Link>
            </div>
          </div>
        </div>
        <div className="base">
          <span>© 2026 RPS Cohorts. All rights reserved.</span>
          <a href="#main">Back to top ↑</a>
        </div>
      </div>
    </footer>
  );
}
