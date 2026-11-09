import { useEffect, useRef, useState } from 'react';

import { useT } from '../i18n';
import { CenteredLoader } from './Loading';

/**
 * Landing surface for `/s/<token>` (NXD-D20).
 *
 * The daemon gate answers 401 before any session exists, so that branch sends
 * the browser through SSO with the token carried in the query. After sign-in,
 * `/auth/callback` returns here; the second pass redeems the token, writes the
 * grant, and hands the project id to the app router.
 */
export function ShareLinkEntry({
  token,
  onResolved,
  onHome,
}: {
  token: string;
  onResolved: (projectId: string) => void;
  onHome: () => void;
}) {
  const t = useT();
  const [failed, setFailed] = useState(false);
  const redeemedRef = useRef(false);

  useEffect(() => {
    if (redeemedRef.current) return;
    let cancelled = false;
    void (async () => {
      let response: Response;
      try {
        response = await fetch('/api/nextore/share-links/resolve', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token }),
        });
      } catch {
        if (!cancelled) setFailed(true);
        return;
      }
      if (cancelled) return;
      if (response.status === 401) {
        redeemedRef.current = true;
        window.location.assign(
          '/auth/start?share=' + encodeURIComponent(token),
        );
        return;
      }
      if (!response.ok) {
        setFailed(true);
        return;
      }
      const payload = (await response.json().catch(() => null)) as
        | { projectId?: unknown }
        | null;
      if (typeof payload?.projectId !== 'string' || !payload.projectId) {
        setFailed(true);
        return;
      }
      redeemedRef.current = true;
      onResolved(payload.projectId);
    })();
    return () => {
      cancelled = true;
    };
  }, [token, onResolved]);

  if (failed) {
    return (
      <div className="entry-shell entry-shell--no-header">
        <div className="empty-card">
          <strong>{t('chat.referenceProject.loadFailed')}</strong>
          <button type="button" className="primary" onClick={onHome}>
            {t('entry.navHome')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="entry-shell entry-shell--no-header">
      <CenteredLoader label={t('entry.loadingWorkspace')} />
    </div>
  );
}
