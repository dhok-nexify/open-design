import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

import { useT } from '../../i18n';
import { Icon } from '../Icon';
import { ProjectShareForm } from './ProjectShareForm';
import styles from './ProjectShareDialog.module.css';

/**
 * Folder-level share dialog for the NexTore edition.
 *
 * Deliberately separate from the artifact dialog: a file link and a project
 * (folder) link are different scopes with different options, and mixing them in
 * one surface made two unrelated actions look like one duplicated feature.
 */
export function ProjectShareDialog({
  projectId,
  onClose,
}: {
  projectId: string;
  onClose: () => void;
}) {
  const t = useT();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const returnFocusRef = useRef<Element | null>(null);

  useEffect(() => {
    returnFocusRef.current = document.activeElement;
    const dialog = dialogRef.current;
    dialog
      ?.querySelector<HTMLElement>('button, select, input, textarea, [href], [tabindex]:not([tabindex="-1"])')
      ?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = dialog?.querySelectorAll<HTMLElement>(
        'button, select, input, textarea, [href], [tabindex]:not([tabindex="-1"])',
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
        aria-labelledby="nextore-project-share-dialog-title"
        data-testid="nextore-project-share-dialog"
      >
        <header className={styles.header}>
          <h2 id="nextore-project-share-dialog-title" className={styles.title}>
            {t('nextore.project.share.title')}
          </h2>
          <button type="button" className={styles.close} onClick={onClose} aria-label={t('common.close')}>
            <Icon name="close" size={16} aria-hidden="true" />
          </button>
        </header>
        <div className={styles.body}>
          <ProjectShareForm projectId={projectId} />
        </div>
      </div>
    </div>,
    document.body,
  );
}
