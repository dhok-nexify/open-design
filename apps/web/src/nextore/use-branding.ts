'use client';

import { useEffect, useState } from 'react';

import { bootstrapBranding, refreshBranding } from './branding';

/**
 * Load the module's brand payload at boot (DESIGN §12.1), then revalidate when
 * the window regains focus so a brand saved in the module settings page reaches
 * an open tab. The revision bump re-renders so `{brandName}` text is
 * re-interpolated; the daemon answers 304 while the version is unchanged.
 *
 * Kept as a hook so `AppInner` carries one call instead of the whole effect.
 */
export function useBrandingRevision(): void {
  const [, setRevision] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const bump = () => {
      if (!cancelled) setRevision((revision) => revision + 1);
    };

    void bootstrapBranding().then((branding) => {
      if (branding) bump();
    });

    const handleFocus = () => {
      void refreshBranding().then((branding) => {
        if (branding) bump();
      });
    };
    window.addEventListener('focus', handleFocus);

    return () => {
      cancelled = true;
      window.removeEventListener('focus', handleFocus);
    };
  }, []);
}
