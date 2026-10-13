import Link from 'next/link';
import styles from './registrations/registrations.module.css';

/* The two admin lists, one click apart. Both pages sit behind the same
   allow-list, so a link here never leads anywhere the viewer can't open. */
const TABS = [
  ['workshops', '/admin/workshops', 'Workshops'],
  ['registrations', '/admin/registrations', 'Workshop registrations', 'Registrations'],
  ['logins', '/admin/logins', 'Logins'],
  ['hosts', '/admin/hosts', 'Hosts'],
];

export default function AdminTabs({ current }) {
  return (
    <nav className={styles.tabs} aria-label="Admin lists">
      {TABS.map(([key, href, label, short]) => (
        <Link
          key={key}
          href={href}
          className={styles.tab}
          aria-current={current === key ? 'page' : undefined}
        >
          {short ? (
            <>
              <span className={styles.tabLong}>{label}</span>
              <span className={styles.tabShort}>{short}</span>
            </>
          ) : label}
        </Link>
      ))}
    </nav>
  );
}
