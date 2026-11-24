import { useCallback, useEffect, useRef, useState } from 'react';

import { useT } from '../../i18n';
import { copyText } from '../../nextore/clipboard';
import { Icon } from '../Icon';
import styles from './ProjectShareForm.module.css';

interface FolderShareState {
  shared: boolean;
  url: string | null;
}

/**
 * Folder-level share control for the NexTore edition.
 *
 * Lives in its own dialog: a project link and a file link are different scopes,
 * so this form never competes with the artifact share form for attention.
 * Reading the link never creates one, creating is upsert, and revoking is
 * idempotent. The control hides itself when the daemon exposes no folder route,
 * so an older daemon simply shows nothing.
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

  const urlInputRef = useRef<HTMLInputElement | null>(null);

  const copy = async () => {
    if (!state.url) return;
    setCopied(await copyText(state.url, urlInputRef.current));
  };

  return (
    <section
      className={styles.form}
      aria-label={t('nextore.project.share.title')}
      data-testid="nextore-project-share"
    >
      <p className={styles.hint}>{t('nextore.share.subtitle')}</p>

      {state.shared && state.url ? (
        <div className={styles.body}>
          <input
            ref={urlInputRef}
            className={styles.url}
            value={state.url}
            readOnly
            onFocus={(event) => event.currentTarget.select()}
            aria-label={t('fileViewer.copyShareLink')}
          />
          <div className={styles.actions}>
            <button type="button" className={styles.secondary} onClick={() => { void copy(); }} disabled={busy}>
              {copied ? t('promptTemplates.copyDone') : t('fileViewer.copyShareLink')}
            </button>
            <button type="button" className={styles.danger} onClick={() => { void revoke(); }} disabled={busy}>
              {t('common.delete')}
            </button>
          </div>
        </div>
      ) : (
        <div className={styles.body}>
          <div className={styles.actions}>
            <button type="button" className={styles.primary} onClick={() => { void create(); }} disabled={busy}>
              <Icon name="link" size={14} aria-hidden="true" />
              <span>{busy ? t('nextore.artifact.share.creating') : t('nextore.project.share.create')}</span>
            </button>
          </div>
        </div>
      )}

      {error ? <p role="alert" className={styles.error}>{error}</p> : null}
    </section>
  );
}
