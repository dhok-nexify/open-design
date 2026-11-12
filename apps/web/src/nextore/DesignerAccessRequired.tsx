import { useT } from '../i18n';
import { brandingLogoUrl, useBranding } from './branding';
import styles from './DesignerAccessRequired.module.css';

/**
 * Full-page refusal for a member who is signed in but has no Designer access.
 *
 * The shell owns detection (see access-required.ts) and renders this before any
 * project surface, so a failing API call can never strand the member on an
 * editable-looking page or the upstream onboarding flow.
 *
 * This is one of the two surfaces that carry the installation logo (the other is
 * the startup curtain): the product mark is absent here, so the tenant identity
 * makes a refusal read as intentional rather than broken. Light background, so
 * the light-surface variant is used.
 */
export function DesignerAccessRequired() {
  const t = useT();
  const branding = useBranding();
  const brandName = branding?.brandName?.trim() || t('app.brand');
  const logo = brandingLogoUrl(branding, 'light') ?? '/logo.svg';
  return (
    <main className={styles.root}>
      <div className={styles.card}>
        <img className={styles.logo} src={logo} alt={brandName} />
        <span className={styles.accent} aria-hidden />
        <span className={styles.brand}>{t('app.brand')}</span>
        <h1 className={styles.title}>{t('accessRequired.title')}</h1>
        <p className={styles.body}>{t('accessRequired.body')}</p>
      </div>
    </main>
  );
}