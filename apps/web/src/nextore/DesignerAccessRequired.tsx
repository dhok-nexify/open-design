import { useT } from '../i18n';
import styles from './DesignerAccessRequired.module.css';

/**
 * Full-page refusal for a member who is signed in but has no Designer access.
 *
 * The shell owns detection (see access-required.ts) and renders this before any
 * project surface, so a failing API call can never strand the member on an
 * editable-looking page or the upstream onboarding flow.
 */
export function DesignerAccessRequired() {
  const t = useT();
  return (
    <main className={styles.root}>
      <div className={styles.card}>
        <span className={styles.brand}>{t('app.brand')}</span>
        <h1 className={styles.title}>{t('accessRequired.title')}</h1>
        <p className={styles.body}>{t('accessRequired.body')}</p>
      </div>
    </main>
  );
}
