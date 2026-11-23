import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import { useT } from '../i18n';
import { Icon } from './Icon';
import styles from './ShareLinkDialog.module.css';

interface ShareLinkSummary {
  id: string;
  createdAt: number;
  expiresAt: number | null;
  revokedAt: number | null;
}

const EXPIRY_OPTIONS = [1, 7, 30, 0] as const;

function formatDate(value: number, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }).format(new Date(value));
  } catch {
    return new Date(value).toISOString().slice(0, 10);
  }
}

/**
 * Share-link management for one project (NXD-D20).
 *
 * Only reachable when the daemon's project access says CanManage; the server
 * re-checks that on every call. The raw URL is shown once at creation because
 * the database only stores its SHA-256 hash.
 */
export function ShareLinkDialog({
  projectId,
  locale,
  onClose,
}: {
  projectId: string;
  locale: string;
  onClose: () => void;
}) {
  const t = useT();
  const [links, setLinks] = useState<ShareLinkSummary[]>([]);
  const [loading, setLoading] = useState(true);
  // NexTore owns folder links (ShareObject). When the daemon exposes that
  // route the dialog manages that link; otherwise it falls back to the legacy
  // Designant link list.
  const [folderShare, setFolderShare] = useState<{ shared: boolean; url: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [expiryDays, setExpiryDays] = useState<number>(7);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // NexTore-first: a 200 here means the platform owns this project's link.
      const folder = await fetch(
        '/api/nextore/projects/' + encodeURIComponent(projectId) + '/share',
        { headers: { accept: 'application/json' } },
      );
      if (folder.ok) {
        const payload = (await folder.json()) as { shared?: unknown; url?: unknown };
        setFolderShare({
          shared: payload.shared === true,
          url: typeof payload.url === 'string' ? payload.url : null,
        });
        setLinks([]);
        setError(null);
        return;
      }
      setFolderShare(null);
      const response = await fetch(
        '/api/nextore/projects/' + encodeURIComponent(projectId) + '/share-links',
        { headers: { accept: 'application/json' } },
      );
      if (!response.ok) {
        setError(t('nextore.share.loadFailed'));
        return;
      }
      const payload = (await response.json()) as { links?: ShareLinkSummary[] };
      setLinks(Array.isArray(payload.links) ? payload.links : []);
      setError(null);
    } catch {
      setError(t('nextore.share.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [projectId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  const activeLinks = useMemo(
    () => links.filter((link) =>
      link.revokedAt === null
      && (link.expiresAt === null || link.expiresAt > Date.now())),
    [links],
  );

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const expiresAt = expiryDays === 0
        ? null
        : new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000).toISOString();
      if (folderShare) {
        const created = await fetch(
          '/api/nextore/projects/' + encodeURIComponent(projectId) + '/share',
          {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({ expiresAt }),
          },
        );
        if (!created.ok) {
          setError(t('fileViewer.publishFileFailed'));
          return;
        }
        const payload = (await created.json()) as { url?: unknown };
        const url = typeof payload.url === 'string' ? payload.url : null;
        setFolderShare({ shared: url !== null, url });
        setCreatedUrl(url);
        return;
      }
      const response = await fetch(
        '/api/nextore/projects/' + encodeURIComponent(projectId) + '/share-links',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ expiresAt }),
        },
      );
      if (!response.ok) {
        setError(t('fileViewer.publishFileFailed'));
        return;
      }
      const payload = (await response.json()) as { link?: { url?: unknown } };
      if (typeof payload.link?.url === 'string') setCreatedUrl(payload.link.url);
      await load();
    } catch {
      setError(t('fileViewer.publishFileFailed'));
    } finally {
      setBusy(false);
    }
  };

  const revokeFolder = async () => {
    if (!window.confirm(t('nextore.share.confirmRevoke'))) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        '/api/nextore/projects/' + encodeURIComponent(projectId) + '/share',
        { method: 'DELETE' },
      );
      if (!response.ok) {
        setError(t('nextore.share.loadFailed'));
        return;
      }
      setFolderShare({ shared: false, url: null });
      setCreatedUrl(null);
    } catch {
      setError(t('nextore.share.loadFailed'));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string) => {
    if (!window.confirm(t('nextore.share.confirmRevoke'))) return;
    setBusy(true);
    try {
      const response = await fetch(
        '/api/nextore/projects/'
          + encodeURIComponent(projectId)
          + '/share-links/'
          + encodeURIComponent(id),
        { method: 'DELETE' },
      );
      if (!response.ok) setError(t('nextore.share.loadFailed'));
      await load();
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!createdUrl) return;
    try {
      await navigator.clipboard.writeText(createdUrl);
      setCopied(true);
    } catch {
      setCopied(false);
    }
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
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-label={t('fileViewer.publishSingleFileTitle')}
        data-testid="nextore-share-link-dialog"
      >
        <header className={styles.head}>
          <div>
            <h2 className={styles.title}>{t('fileViewer.publishSingleFileTitle')}</h2>
            <p className={styles.subtitle}>{t('nextore.share.subtitle')}</p>
          </div>
          <button
            type="button"
            className={styles.close}
            onClick={onClose}
            aria-label={t('common.close')}
          >
            <Icon name="close" size={16} />
          </button>
        </header>

        <div className={styles.createRow}>
          <label className={styles.field}>
            <span>{t('nextore.share.expiry')}</span>
            <select
              value={expiryDays}
              onChange={(event) => setExpiryDays(Number(event.target.value))}
              disabled={busy}
            >
              {EXPIRY_OPTIONS.map((days) => (
                <option key={days} value={days}>
                  {days === 0
                    ? t('nextore.share.never')
                    : t('nextore.share.days', { count: days })}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className={styles.createButton}
            onClick={() => { void create(); }}
            disabled={busy}
          >
            {t('common.create')}
          </button>
        </div>

        {!createdUrl && folderShare?.url ? (
          <div className={styles.created}>
            <input
              className={styles.url}
              value={folderShare.url}
              readOnly
              onFocus={(event) => event.currentTarget.select()}
              aria-label={t('fileViewer.copyShareLink')}
            />
            <button
              type="button"
              className={styles.copyButton}
              onClick={() => { void navigator.clipboard.writeText(folderShare.url ?? '').then(() => setCopied(true)).catch(() => setCopied(false)); }}
            >
              {copied ? t('promptTemplates.copyDone') : t('fileViewer.copyShareLink')}
            </button>
          </div>
        ) : null}

        {createdUrl ? (
          <div className={styles.created}>
            <input
              className={styles.url}
              value={createdUrl}
              readOnly
              onFocus={(event) => event.currentTarget.select()}
              aria-label={t('fileViewer.copyShareLink')}
            />
            <button type="button" className={styles.copyButton} onClick={() => { void copy(); }}>
              {copied ? t('promptTemplates.copyDone') : t('fileViewer.copyShareLink')}
            </button>
          </div>
        ) : null}

        {error ? <div role="alert" className={styles.error}>{error}</div> : null}

        <div className={styles.listHead}>
          <span>{t('nextore.share.expiry')}</span>
        </div>
        {loading ? (
          <p className={styles.muted}>{t('common.loading')}</p>
        ) : folderShare ? (
          folderShare.shared ? (
            <ul className={styles.list}>
              <li className={styles.item}>
                <div className={styles.itemText}>
                  <span>{t('nextore.share.subtitle')}</span>
                </div>
                <button
                  type="button"
                  className={styles.revoke}
                  disabled={busy}
                  onClick={() => { void revokeFolder(); }}
                >
                  {t('common.delete')}
                </button>
              </li>
            </ul>
          ) : (
            <p className={styles.muted}>{t('nextore.share.empty')}</p>
          )
        ) : activeLinks.length === 0 ? (
          <p className={styles.muted}>{t('nextore.share.empty')}</p>
        ) : (
          <ul className={styles.list}>
            {activeLinks.map((link) => (
              <li key={link.id} className={styles.item}>
                <div className={styles.itemText}>
                  <span>
                    {link.expiresAt === null
                      ? t('nextore.share.never')
                      : formatDate(link.expiresAt, locale)}
                  </span>
                  <small>{formatDate(link.createdAt, locale)}</small>
                </div>
                <button
                  type="button"
                  className={styles.revoke}
                  disabled={busy}
                  onClick={() => { void revoke(link.id); }}
                >
                  {t('common.delete')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>,
    document.body,
  );
}
