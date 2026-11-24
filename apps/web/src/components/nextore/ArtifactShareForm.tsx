import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  NextoreArtifactRepresentation,
  NextoreArtifactShareResult,
} from '@open-design/contracts';

import { useT } from '../../i18n';
import {
  describeArtifactShare,
  renderSnapshot,
  revokeArtifactShare,
  shareArtifact,
  waitForSnapshot,
} from '../../nextore/artifact-client';
import { Icon } from '../Icon';
import styles from './ArtifactShareForm.module.css';

const EXPIRY_DAYS = [1, 7, 30, 0] as const;

function isoAfterDays(days: number): string | null {
  if (days <= 0) return null;
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * The NexTore share form, shared by the artifact dialog and the project panel.
 * It only collects options and renders the URL the module returned; it never
 * mints a Designer token.
 */
export function ArtifactShareForm({
  projectId,
  artifactId,
  initialRepresentation = 'snapshot',
  autoFocus = false,
}: {
  projectId: string;
  artifactId: string;
  initialRepresentation?: NextoreArtifactRepresentation;
  autoFocus?: boolean;
}) {
  const t = useT();
  const [representation, setRepresentation] = useState<NextoreArtifactRepresentation>(
    initialRepresentation === 'cover' ? 'snapshot' : initialRepresentation,
  );
  const [previewOnly, setPreviewOnly] = useState(true);
  const [expiryDays, setExpiryDays] = useState<number>(7);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [share, setShare] = useState<NextoreArtifactShareResult | null>(null);
  // A link outlives the dialog that minted it. Without reading it back on open,
  // the only reachable action is "create another link" and the old one can
  // never be copied or revoked from Designer.
  const [existingUrl, setExistingUrl] = useState<string | null>(null);
  const [loadingExisting, setLoadingExisting] = useState(true);
  const [copied, setCopied] = useState<'idle' | 'ok' | 'failed'>('idle');
  const firstFieldRef = useRef<HTMLSelectElement | null>(null);

  const normalized = representation === 'cover' ? 'snapshot' : representation;

  useEffect(() => {
    let cancelled = false;
    setLoadingExisting(true);
    void (async () => {
      try {
        const current = await describeArtifactShare(projectId, artifactId, normalized);
        if (cancelled) return;
        setExistingUrl(current && current.shared && current.url ? current.url : null);
      } catch {
        // A read failure must not block sharing; the create call reports it.
        if (!cancelled) setExistingUrl(null);
      } finally {
        if (!cancelled) setLoadingExisting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [artifactId, normalized, projectId]);

  const linkUrl = share?.url ?? existingUrl;

  const create = useCallback(async () => {
    setBusy(true);
    setError(null);
    setCopied('idle');
    const expiry = isoAfterDays(expiryDays);
    const request = {
      representation: normalized,
      previewOnly,
      ...(expiry ? { expiresAt: expiry } : {}),
      ...(password.trim() ? { password: password.trim() } : {}),
    };
    try {
      try {
        setShare(await shareArtifact(projectId, artifactId, request));
        return;
      } catch (cause) {
        // A snapshot is rendered on demand: the first share attempt reports
        // share_not_ready, we render, wait for the publish, then retry once.
        const code = cause instanceof Error ? cause.message : '';
        if (code !== 'share_not_ready' || normalized !== 'snapshot') throw cause;
      }
      await renderSnapshot(projectId, artifactId);
      if (!await waitForSnapshot(projectId, artifactId)) {
        throw new Error('snapshot_render_timeout');
      }
      setShare(await shareArtifact(projectId, artifactId, request));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'share_failed');
    } finally {
      setBusy(false);
    }
  }, [artifactId, expiryDays, normalized, password, previewOnly, projectId]);

  const revoke = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await revokeArtifactShare(projectId, artifactId, normalized);
      setShare(null);
      setExistingUrl(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'share_failed');
    } finally {
      setBusy(false);
    }
  }, [artifactId, normalized, projectId]);

  const copy = useCallback(async () => {
    if (!linkUrl) return;
    try {
      await navigator.clipboard.writeText(linkUrl);
      setCopied('ok');
    } catch {
      setCopied('failed');
    }
  }, [linkUrl]);

  return (
    <div className={styles.form}>
      <div className={styles.grid}>
        <label className={styles.field}>
          <span>{t('nextore.artifact.share.representation')}</span>
          <select
            ref={(node) => {
              firstFieldRef.current = node;
              if (autoFocus) node?.focus();
            }}
            value={normalized}
            onChange={(event) => setRepresentation(event.target.value as NextoreArtifactRepresentation)}
            disabled={busy}
          >
            <option value="snapshot">{t('nextore.artifact.share.snapshot')}</option>
            <option value="source">{t('nextore.artifact.share.source')}</option>
          </select>
        </label>

        <label className={styles.field}>
          <span>{t('nextore.artifact.share.expiry')}</span>
          <select
            value={String(expiryDays)}
            onChange={(event) => setExpiryDays(Number(event.target.value))}
            disabled={busy}
          >
            {EXPIRY_DAYS.map((days) => (
              <option key={days} value={String(days)}>
                {days === 0
                  ? t('nextore.artifact.share.never')
                  : t('nextore.artifact.share.days', { count: String(days) })}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className={styles.checkbox}>
        <input
          type="checkbox"
          checked={previewOnly}
          onChange={(event) => setPreviewOnly(event.target.checked)}
          disabled={busy}
        />
        <span>{t('nextore.artifact.share.previewOnly')}</span>
      </label>

      <label className={styles.field}>
        <span>{t('nextore.artifact.share.password')}</span>
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          disabled={busy}
          autoComplete="new-password"
        />
      </label>

      <p className={styles.note}>{t('nextore.artifact.share.pinUnavailable')}</p>

      {error && (
        <p className={styles.error} role="alert">
          <Icon name="alert-triangle" size={14} aria-hidden="true" />
          <span>
            {t('nextore.artifact.share.failed')}
            <span className={styles.errorCode}> ({error})</span>
          </span>
        </p>
      )}

      {loadingExisting && !linkUrl ? (
        <p role="status" aria-live="polite">{t('nextore.artifact.status.loading')}</p>
      ) : linkUrl ? (
        <div className={styles.result}>
          <label className={styles.field}>
            <span>{t('nextore.artifact.share.link')}</span>
            <input readOnly value={linkUrl} onFocus={(event) => event.currentTarget.select()} />
          </label>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.primary}
              onClick={() => void copy()}
              disabled={busy}
              aria-busy={busy}
            >
              {copied === 'ok' ? t('nextore.artifact.share.copied') : t('nextore.artifact.share.copy')}
            </button>
            <button
              type="button"
              className={styles.danger}
              onClick={() => void revoke()}
              disabled={busy}
              aria-busy={busy}
            >
              {t('nextore.artifact.share.revoke')}
            </button>
          </div>
          <p className={styles.srOnly} role="status" aria-live="polite">
            {copied === 'ok'
              ? t('nextore.artifact.share.copied')
              : copied === 'failed' ? t('nextore.artifact.share.copyFailed') : ''}
          </p>
          {copied === 'failed' && (
            <p className={styles.error} role="alert">{t('nextore.artifact.share.copyFailed')}</p>
          )}
        </div>
      ) : (
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.primary}
            onClick={() => void create()}
            disabled={busy}
            aria-busy={busy}
          >
            {busy ? t('nextore.artifact.share.creating') : t('nextore.artifact.share.create')}
          </button>
        </div>
      )}
    </div>
  );
}
