import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import type {
  NextoreArtifactRecord,
  NextoreArtifactRepresentation,
} from '@open-design/contracts';

import { useT } from '../../i18n';
import {
  artifactDownloadUrl,
  fetchProjectArtifacts,
  primaryArtifact,
} from '../../nextore/artifact-client';
import { Icon } from '../Icon';
import { ArtifactShareForm } from './ArtifactShareForm';
import { ArtifactStatusChip } from './ArtifactStatusChip';
import { LegacyShareBanner } from './LegacyShareBanner';
import styles from './NextoreArtifactDialog.module.css';

/**
 * Project-level artifact dialog (P04f).
 *
 * Shows the publish state, offers the NexTore download for the published
 * representations, and hosts the ShareObject form. Downloads go through the
 * daemon proxy, never the local archive route.
 */
export function NextoreArtifactDialog({
  projectId,
  artifactId,
  onClose,
}: {
  projectId: string;
  /** Omitted only by the project-level legacy entry; a file row always names its file. */
  artifactId?: string;
  onClose: () => void;
}) {
  const t = useT();
  const [records, setRecords] = useState<NextoreArtifactRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const returnFocusRef = useRef<Element | null>(null);

  // One dialog, one file: a project with several pages must never make the
  // caller guess which artifact a link belongs to.
  const primary = useMemo(
    () => (artifactId
      ? records.find((row) => row.artifactId === artifactId) ?? null
      : primaryArtifact(records)),
    [artifactId, records],
  );
  const published = useMemo(
    () => records.filter((row) => row.status === 'published'
      && row.artifactId === (primary?.artifactId ?? '')
      && (row.representation === 'source' || row.representation === 'snapshot')),
    [primary?.artifactId, records],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await fetchProjectArtifacts(projectId);
        if (cancelled) return;
        setRecords(list);
        setFailed(false);
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    returnFocusRef.current = document.activeElement;
    const dialog = dialogRef.current;
    // Land focus inside the modal immediately; the close button is present
    // before the async list lands, so the first interaction is never outside
    // the dialog.
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
      // Restore after the portal is gone: focusing a node that is about to be
      // removed drops focus to <body> instead of the opener.
      if (previous instanceof HTMLElement) {
        queueMicrotask(() => {
          if (previous.isConnected) previous.focus();
        });
      }
    };
  }, [onClose]);

  const download = (representation: NextoreArtifactRepresentation, version?: number) => {
    if (!primary) return;
    window.location.assign(artifactDownloadUrl(projectId, primary.artifactId, {
      representation,
      ...(typeof version === 'number' ? { version } : {}),
    }));
  };

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
        aria-labelledby="nextore-project-artifact-title"
      >
        <header className={styles.header}>
          <h2 id="nextore-project-artifact-title">{t('nextore.artifact.dialog.title')}</h2>
          <button type="button" className={styles.close} onClick={onClose} aria-label={t('common.close')}>
            <Icon name="close" size={16} aria-hidden="true" />
          </button>
        </header>

        <div className={styles.body} aria-busy={loading}>
          {loading ? (
            <p role="status" aria-live="polite">{t('nextore.artifact.status.loading')}</p>
          ) : failed ? (
            <p role="alert">{t('nextore.artifact.status.unavailable')}</p>
          ) : !primary ? (
            <p role="status" aria-live="polite">{t('nextore.artifact.downloadUnavailable')}</p>
          ) : (
            <>
              <LegacyShareBanner projectId={projectId} />
              <div className={styles.row}>
                <ArtifactStatusChip projectId={projectId} artifactId={primary.artifactId} />
              </div>

              <div className={styles.downloads}>
                <span className={styles.downloadLabel}>{t('nextore.artifact.download')}</span>
                {published.length === 0 ? (
                  <p role="status" aria-live="polite">{t('nextore.artifact.downloadUnavailable')}</p>
                ) : (
                  published.map((row) => (
                    <button
                      key={row.representation}
                      type="button"
                      className={styles.download}
                      onClick={() => download(row.representation, row.currentVersion)}
                    >
                      <Icon name="download" size={14} aria-hidden="true" />
                      <span>
                        {row.representation === 'snapshot'
                          ? t('nextore.artifact.share.snapshot')
                          : t('nextore.artifact.share.source')}
                      </span>
                    </button>
                  ))
                )}
              </div>

              <hr className={styles.separator} />
              <h3 className={styles.shareTitle}>{t('nextore.artifact.share.title')}</h3>
              <ArtifactShareForm
                projectId={projectId}
                artifactId={primary.artifactId}
                initialRepresentation={published.some((row) => row.representation === 'snapshot')
                  ? 'snapshot'
                  : 'source'}
              />

            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
