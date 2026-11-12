import { useEffect, useState } from 'react';

import { useT } from '../i18n';
import { brandingLogoUrl, useBranding } from '../nextore/branding';
import { NEXTORE_WEB_EDITION } from '../nextore/features';
import styles from './BrandSplash.module.css';
import { CenteredLoader } from './Loading';

/**
 * First-paint loading surface (DESIGN §12.1).
 *
 * The NexTore edition paints a dark curtain with the installation's dark-surface
 * logo, its loading text and a brand-coloured progress line: the one moment the
 * tenant identity owns the screen before any workspace chrome exists. Upstream
 * keeps the plain light loader so its product is untouched.
 *
 * The curtain is delayed: a fast boot never flashes dark, and a slow boot fades
 * in instead of popping. That delay is the whole reason this is a component
 * rather than a CSS class on the existing loader.
 */
const SPLASH_DELAY_MS = 200;

export function BrandSplash() {
  const t = useT();
  const branding = useBranding();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(true), SPLASH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);

  if (NEXTORE_WEB_EDITION !== 'nextore') {
    return <CenteredLoader label={t('entry.loadingWorkspace')} />;
  }
  if (!visible) return null;

  const brandName = branding?.brandName?.trim() || t('app.brand');
  const logo = brandingLogoUrl(branding, 'dark') ?? '/logo-mark.svg';
  const label = branding?.loadingText?.trim() || t('entry.loadingWorkspace');

  return (
    <div className={styles.root} data-testid="brand-splash">
      <div className={styles.inner}>
        <img className={styles.logo} src={logo} alt={brandName} />
        <span className={styles.label} role="status">
          {label}
        </span>
        <span className={styles.progress} aria-hidden />
      </div>
    </div>
  );
}
