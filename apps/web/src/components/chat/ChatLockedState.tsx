/**
 * Locked chat column for a shared NexTore project the member may only read.
 *
 * A spinner is a promise that something is on its way. In this state nothing
 * is: the conversations endpoint answers 403 for a read-only viewer, so the
 * panel would spin forever. This state replaces that false promise with the
 * one thing the viewer needs to know — why the column is empty, and what they
 * can still do (review the artifacts, leave comments).
 *
 * Deliberately not an error treatment: a permission boundary is normal, not a
 * failure. Neutral surface, lock glyph, no red.
 */
import type { ReactElement } from 'react';

import { useT } from '../../i18n';
import { Icon } from '../Icon';
import { chatSeam } from './ChatRoot';
import styles from './ChatLockedState.module.css';

export function ChatLockedState(): ReactElement {
  const t = useT();

  return (
    <section
      {...chatSeam('pane ' + styles.pane)}
      data-testid="chat-locked-state"
      aria-labelledby="chat-locked-title"
    >
      <div className={styles.inner}>
        <span className={styles.badge} aria-hidden="true">
          <Icon name="lock" size={20} />
        </span>
        <h2 id="chat-locked-title" className={styles.title}>
          {t('chat.lockedTitle')}
        </h2>
        <p className={styles.body}>{t('chat.lockedBody')}</p>
        <p className={styles.hint}>{t('chat.lockedHint')}</p>
      </div>
    </section>
  );
}
