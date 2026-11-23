import { useCallback, useEffect, useState } from 'react';

import { useT } from '../../i18n';
import styles from './NextoreArtifactDialog.module.css';

interface FolderShareState {
  shared: boolean;
  url: string | null;
}

/**
 * Folder-level share control for the NexTore edition.
 *
 * The folder link is a NexTore ShareObject owned by the platform: reading it
 * never creates one, creating it is upsert, and revoking is idempotent. This
 * section only renders when the daemon exposes the folder route, so the same
 * dialog keeps working against an older daemon.
 */
export function ProjectShareForm({ projectId }: { projectId: string }) {
  const t = useT();
  const [state, setState] = useState<FolderShareState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const endpoint = '/api/nextore/projects/' + encodeURIComponent(projectId) + '/share';

  const load = useCallback(async () => {
    try {
      const response = await fetch(endpoint, { headers: { accept: 'application/json' } });
      if (!response.ok) {
        setState(null);
        return;
      }
      const payload = (await response.json()) as { shared?: unknown; url?: unknown };
      setState({
        shared: payload.shared === true,
        url: typeof payload.url === 'string' ? payload.url : null,
      });
    } catch {
      setState(null);
    }
  }, [endpoint]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  if (!state) return null;

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({}),
      });
      if (!response.ok) {
        setError(t('fileViewer.publishFileFailed'));
        return;
      }
      const payload = (await response.json()) as { url?: unknown };
      const url = typeof payload.url === 'string' ? payload.url : null;
      setState({ shared: url !== null, url });
    } catch {
      setError(t('fileViewer.publishFileFailed'));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    if (!window.confirm(t('nextore.share.confirmRevoke'))) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(endpoint, { method: 'DELETE' });
      if (!response.ok) {
        setError(t('nextore.share.loadFailed'));
        return;
      }
      setState({ shared: false, url: null });
    } catch {
      setError(t('nextore.share.loadFailed'));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!state.url) return;
    try {
      await navigator.clipboard.writeText(state.url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section className={styles.projectShare} aria-label={t('nextore.project.share.title')}>
      <h3 className={styles.shareTitle}>{t('nextore.project.share.title')}</h3>
      <p className={styles.shareHint}>{t('nextore.share.subtitle')}</p>
      {state.shared && state.url ? (
        <div className={styles.projectShareRow}>
          <input
            className={styles.projectShareUrl}
            value={state.url}
            readOnly
            onFocus={(event) => event.currentTarget.select()}
            aria-label={t('fileViewer.copyShareLink')}
          />
          <button type="button" className={styles.projectShareButton} onClick={() => { void copy(); }} disabled={busy}>
            {copied ? t('promptTemplates.copyDone') : t('fileViewer.copyShareLink')}
          </button>
          <button type="button" className={styles.projectShareDanger} onClick={() => { void revoke(); }} disabled={busy}>
            {t('common.delete')}
          </button>
        </div>
      ) : (
        <div className={styles.projectShareRow}>
          <button type="button" className={styles.projectShareButton} onClick={() => { void create(); }} disabled={busy}>
            {t('common.create')}
          </button>
        </div>
      )}
      {error ? <p role="alert" className={styles.projectShareError}>{error}</p> : null}
    </section>
  );
}
