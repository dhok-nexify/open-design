import { Button } from '@open-design/components';

import { Icon } from '../components/Icon';
import { useT } from '../i18n';
import { brandingLogoUrl, useBranding } from './branding';
import { signInAgain } from './sign-out';
import styles from './DesignerSignedOut.module.css';

/**
 * Full page for a tab the person signed out of on purpose.
 *
 * Without it the shell would look broken: every API call now answers
 * SESSION_REQUIRED, and the session wrapper would bounce the tab straight back
 * into OAuth — silently re-creating the session the user just ended. The
 * signed-out marker holds that bounce off, and this page is what replaces it.
 *
 * Deliberately calm, not an error: signing out worked.
 */
export function DesignerSignedOut({
  onSignIn = () => signInAgain(),
}: {
  onSignIn?: () => void;
}) {
  const t = useT();
  const branding = useBranding();
  const brandName = branding?.brandName?.trim() || t('app.brand');
  const logo = brandingLogoUrl(branding, 'light') ?? '/logo.svg';

  return (
    <main className={styles.root} data-testid="designer-signed-out">
      <div className={styles.card}>
        <img className={styles.logo} src={logo} alt={brandName} />
        <span className={styles.accent} aria-hidden />
        <span className={styles.brand}>{t('app.brand')}</span>
        <h1 className={styles.title}>{t('signedOut.title')}</h1>
        <p className={styles.body}>{t('signedOut.body')}</p>
        <Button className={styles.action} variant="primary" onClick={onSignIn}>
          <Icon name="log-out" size={14} /> {t('signedOut.action')}
        </Button>
      </div>
    </main>
  );
}
