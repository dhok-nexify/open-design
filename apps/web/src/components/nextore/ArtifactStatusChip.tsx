import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  NextoreArtifactRepresentation,
  NextoreArtifactRepresentationStatus,
} from '@open-design/contracts';

import { useT, type DictKey } from '../../i18n';
import {
  describeArtifactError,
  fetchArtifactStatus,
  retryArtifact,
  subscribeArtifactEvents,
} from '../../nextore/artifact-client';
import { Icon } from '../Icon';
import styles from './ArtifactStatusChip.module.css';

export type ArtifactChipState =
  | 'loading'
  | 'not_published'
  | 'publishing'
  | 'published'
  | 'failed'
  | 'missing'
  | 'unavailable';

/** Pure mapping so the visual states stay testable without a DOM. */
export function resolveArtifactChipState(
  row: NextoreArtifactRepresentationStatus | null,
  loadFailed: boolean,
): ArtifactChipState {
  if (loadFailed) return 'unavailable';
  if (!row) return 'not_published';
  switch (row.artifact.status) {
    case 'published':
      return 'published';
    case 'publish_pending':
      return 'publishing';
    case 'failed':
      return 'failed';
    case 'orphaned':
      return 'missing';
    default:
      return 'not_published';
  }
}

const STATE_KEY: Record<ArtifactChipState, DictKey> = {
  loading: 'nextore.artifact.status.loading',
  not_published: 'nextore.artifact.status.notPublished',
  publishing: 'nextore.artifact.status.publishing',
  published: 'nextore.artifact.status.published',
  failed: 'nextore.artifact.status.failed',
  missing: 'nextore.artifact.status.missing',
  unavailable: 'nextore.artifact.status.unavailable',
};

const STATE_ICON: Record<ArtifactChipState, 'check' | 'spinner' | 'alert-triangle' | 'minus' | 'reload'> = {
  loading: 'spinner',
  not_published: 'minus',
  publishing: 'spinner',
  published: 'check',
  failed: 'alert-triangle',
  missing: 'minus',
  unavailable: 'alert-triangle',
};

/**
 * Artifact publish state (P04f).
 *
 * Reads the status API once, then follows the project `nextore-artifact` SSE
 * events. A dropped stream refetches rather than guessing, so the chip never
 * shows an optimistic success. Text plus icon carry the state, never colour
 * alone.
 */
export function ArtifactStatusChip({
  projectId,
  artifactId,
  representation = 'source',
}: {
  projectId: string;
  artifactId: string;
  representation?: NextoreArtifactRepresentation;
}) {
  const t = useT();
  const [row, setRow] = useState<NextoreArtifactRepresentationStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const alive = useRef(true);

  const load = useCallback(async () => {
    try {
      const status = await fetchArtifactStatus(projectId, artifactId);
      if (!alive.current) return;
      const match = status.representations.find(
        (item) => item.representation === representation,
      ) ?? null;
      setRow(match);
      setLoadFailed(false);
    } catch {
      if (!alive.current) return;
      setLoadFailed(true);
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [artifactId, projectId, representation]);

  useEffect(() => {
    alive.current = true;
    setLoading(true);
    void load();
    const unsubscribe = subscribeArtifactEvents(
      projectId,
      (event) => {
        if (event.artifactId !== artifactId || event.representation !== representation) return;
        void load();
      },
      () => void load(),
    );
    return () => {
      alive.current = false;
      unsubscribe();
    };
  }, [artifactId, load, projectId, representation]);

  const state = loading ? 'loading' : resolveArtifactChipState(row, loadFailed);
  const errorKey = describeArtifactError(row?.artifact.lastError);

  const retry = useCallback(async () => {
    setRetrying(true);
    try {
      await retryArtifact(projectId, artifactId, representation);
      await load();
    } catch {
      setLoadFailed(true);
    } finally {
      setRetrying(false);
    }
  }, [artifactId, load, projectId, representation]);

  const versionLabel = row?.artifact.currentVersion
    ? t(STATE_KEY[state], { version: String(row.artifact.currentVersion) })
    : t(STATE_KEY[state]);

  return (
    <span className={styles.root} data-state={state}>
      <span
        className={styles.chip}
        role={state === 'failed' || state === 'unavailable' ? 'alert' : 'status'}
        aria-live={state === 'failed' || state === 'unavailable' ? 'assertive' : 'polite'}
      >
        <Icon name={STATE_ICON[state]} size={12} aria-hidden="true" />
        <span>{versionLabel}</span>
      </span>
      {state === 'failed' && (
        <button
          type="button"
          className={styles.retry}
          onClick={() => void retry()}
          disabled={retrying}
        >
          {retrying ? t('nextore.artifact.retrying') : t('nextore.artifact.retry')}
        </button>
      )}
      {state === 'failed' && errorKey !== 'none' && errorKey !== 'generic' && (
        <span className={styles.hint}>{t(('nextore.artifact.reason.' + errorKey) as DictKey)}</span>
      )}
    </span>
  );
}
