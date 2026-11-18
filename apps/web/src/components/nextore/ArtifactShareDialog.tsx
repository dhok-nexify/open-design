import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

import type { NextoreArtifactRepresentation } from '@open-design/contracts';

import { useT } from '../../i18n';
import { Icon } from '../Icon';
import { ArtifactShareForm } from './ArtifactShareForm';
import styles from './ArtifactShareDialog.module.css';

/**
 * P04f modal shell for the NexTore share form. Focus enters the dialog, Tab is
 * trapped, Escape closes, and focus returns to the element that opened it.
 */
export function ArtifactShareDialog({
  projectId,
  artifactId,
  initialRepresentation = 'snapshot',
  onClose,
}: {
  projectId: string;
  artifactId: string;
  initialRepresentation?: NextoreArtifactRepresentation;
  onClose: () => void;
}) {
  const t = useT();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const returnFocusRef = useRef<Element | null>(null);

  useEffect(() => {
    returnFocusRef.current = document.activeElement;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      const previous = returnFocusRef.current;
      // Restore after the portal is gone: focusing a node that is about to be
      // removed drops focus to <body> instead of the opener.
      if (previous instanceof HTMLElement) {
        queueMicrotask(() => {
          if (previous.isConnected) previous.focus();
        });
      }
    };
  }, [onClose]);

  return createPortal(
    <div
      className={styles.backdrop}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="nextore-artifact-share-title"
      >
        <header className={styles.header}>
          <h2 id="nextore-artifact-share-title">{t('nextore.artifact.share.title')}</h2>
          <button type="button" className={styles.close} onClick={onClose} aria-label={t('common.close')}>
            <Icon name="close" size={16} aria-hidden="true" />
          </button>
        </header>
        <div className={styles.body}>
          <ArtifactShareForm
            projectId={projectId}
            artifactId={artifactId}
            initialRepresentation={initialRepresentation}
            autoFocus
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}
