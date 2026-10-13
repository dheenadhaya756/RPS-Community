import SiteShell from '@/components/community/SiteShell';
import AdminTabs from './AdminTabs';
import styles from './registrations/registrations.module.css';

const ROWS = [0, 1, 2, 3, 4, 5];
const STEPS = ['Basics', 'The session', 'People and room', 'After the session'];

/* Shown the moment an admin tab is clicked. The title is real. The bars stand
   in for whatever still has to come from Supabase. A workshop form uses the
   step-and-fields shape; the lists use a table. */
export default function AdminLoading({ title, tab, variant = 'list' }) {
  return (
    <SiteShell active="">
      <div className={'wrap page-top ' + styles.page} aria-busy="true">
        <AdminTabs current={tab} />
        <header className={styles.head}>
          <div className={styles.picked}>
            <span className={styles.eyebrow}>Admin</span>
            <h1 className={styles.title}>{title}</h1>
            <span className={styles.bone + ' ' + styles.boneSub} />
          </div>
          <span className={styles.bone + ' ' + styles.boneBtn} />
        </header>
        {variant === 'form' ? <FormSkeleton title={title} /> : <ListSkeleton title={title} />}
      </div>
    </SiteShell>
  );
}

function ListSkeleton({ title }) {
  return (
    <>
      <div className={styles.controls}>
        <span className={styles.bone + ' ' + styles.boneSearch} />
        <span className={styles.bone + ' ' + styles.boneSeg} />
      </div>
      <div className={styles.scroller + ' ' + styles.boneTable} role="status">
        <span className={styles.sr}>Loading {title}</span>
        {ROWS.map((row) => (
          <div className={styles.boneRow} key={row}>
            <span className={styles.bone + ' ' + styles.boneFace} />
            <span className={styles.boneLines}>
              <span className={styles.bone + ' ' + styles.boneLine} style={{ width: `${78 - row * 6}%` }} />
              <span className={styles.bone + ' ' + styles.boneLineShort} />
            </span>
            <span className={styles.boneLines + ' ' + styles.boneMid}>
              <span className={styles.bone + ' ' + styles.boneLine} style={{ width: `${64 - row * 4}%` }} />
            </span>
            <span className={styles.bone + ' ' + styles.boneChip} />
          </div>
        ))}
      </div>
    </>
  );
}

function FormSkeleton({ title }) {
  return (
    <div className={styles.formSkel + ' admin-form-layout'} role="status">
      <span className={styles.sr}>Loading {title}</span>
      <div className={styles.formSteps + ' admin-form-steps'}>
        {STEPS.map((label) => (
          <span className={styles.bone + ' ' + styles.formStep + ' admin-form-step'} key={label} />
        ))}
      </div>
      <div className={styles.formPanel}>
        <div className={styles.formPair}>
          <Field />
          <Field />
        </div>
        <Field />
        <Field tall />
        <Field tall />
      </div>
    </div>
  );
}

function Field({ tall }) {
  return (
    <span className={styles.formField}>
      <span className={styles.bone + ' ' + styles.formLabel} />
      <span className={styles.bone + ' ' + (tall ? styles.formArea : styles.formInput)} />
    </span>
  );
}
