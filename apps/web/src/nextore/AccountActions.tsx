'use client';

import { useState } from 'react';

import { Icon } from '../components/Icon';
import { useT } from '../i18n';
import { signInUrl, signOutOfDesigner } from './sign-out';
import styles from './AccountActions.module.css';

export interface NextoreAccountActionsProps {
  /** Injectable navigation so the flow is testable without a real page load. */
  onNavigate?: (url: string) => void;
  /** Injectable sign-out call for the same reason. */
  onSignOut?: () => Promise<boolean>;
}

/**
 * Session controls for the NexTore edition, inside the workspace switcher.
 *
 * The switcher is where this edition already answers "whose workspace am I
 * looking at", so ending or replacing that identity belongs here rather than
 * in the upstream account menu, which describes the AMR account.
 *
 * Both rows exist because the platform has no back-channel logout: signing out
 * of NexTore leaves this OAuth connection (and therefore this tab) working, so
 * the person at the keyboard has to be able to end it themselves.
 */
export function NextoreAccountActions({
  onNavigate = (url) => window.location.assign(url),
  onSignOut = () => signOutOfDesigner(),
}: NextoreAccountActionsProps) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function endSession(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    const ended = await onSignOut();
    setBusy(false);
    if (ended) {
      onNavigate('/');
      return;
    }
    // The session is still live on the daemon. Saying nothing here would read
    // as a working sign-out, which is the one outcome we must not fake.
    setFailed(true);
  }

  function switchAccount(): void {
    if (busy) return;
    // No sign-out first: the OAuth callback replaces the previous session row,
    // and one click beats two.
    onNavigate(signInUrl('/'));
  }

  return (
    <div
      className="entry-nav-rail__workspace-actions"
      data-testid="nextore-account-actions"
    >
      <div className="entry-nav-rail__menu-divider" />
      <button
        type="button"
        role="menuitem"
        className="entry-nav-rail__menu-item"
        disabled={busy}
        onClick={switchAccount}
      >
        <Icon name="external-link" size={15} /> {t('nextoreAccount.switchAccount')}
      </button>
      <button
        type="button"
        role="menuitem"
        className="entry-nav-rail__menu-item"
        disabled={busy}
        onClick={() => {
          void endSession();
        }}
      >
        <Icon name="log-out" size={15} /> {t('nextoreAccount.signOut')}
      </button>
      {failed ? (
        <p className={styles.note} role="alert" data-testid="nextore-sign-out-failed">
          {t('nextoreAccount.signOutFailed')}
        </p>
      ) : null}
    </div>
  );
}
