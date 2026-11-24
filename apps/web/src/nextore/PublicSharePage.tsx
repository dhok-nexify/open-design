'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import type {
  NextorePublicShareDescriptor,
  NextorePublicShareItem,
} from '@open-design/contracts';

import styles from './PublicSharePage.module.css';

type Copy = {
  brand: string;
  brandSub: string;
  previewOnly: string;
  downloadable: string;
  loading: string;
  loadingHint: string;
  invalidTitle: string;
  invalidBody: string;
  expiredTitle: string;
  expiredBody: string;
  restrictedTitle: string;
  restrictedBody: string;
  openInNextore: string;
  openFailedTitle: string;
  openFailedBody: string;
  retry: string;
  download: string;
  expires: string;
  unsupported: string;
  empty: string;
  pages: string;
  openPage: string;
  openFolder: string;
  folderLabel: string;
  allPages: string;
  close: string;
  previous: string;
  next: string;
};

const ZH: Copy = {
  brand: 'NexTore Designer',
  brandSub: '由 Nexify 出品',
  previewOnly: '僅供預覽',
  downloadable: '可下載',
  loading: '正在開啟分享內容',
  loadingHint: '文件較大時可能需要幾秒鐘。',
  invalidTitle: '此連結已失效',
  invalidBody: '分享者可能已撤銷連結，或連結已過期。請向分享者索取新的連結。',
  expiredTitle: '此連結已過期',
  expiredBody: '連結已超過分享者設定的有效期。請向分享者索取新的連結。',
  restrictedTitle: '此連結需要額外驗證',
  restrictedBody: '這個分享設有密碼或對象限制，需要在 NexTore 中開啟。',
  openInNextore: '在 NexTore 開啟',
  openFailedTitle: '暫時無法開啟',
  openFailedBody: '分享服務沒有回應。請稍後再試一次。',
  retry: '重新整理',
  download: '下載檔案',
  expires: '有效至',
  unsupported: '此檔案格式無法在瀏覽器中預覽。',
  empty: '此資料夾尚無可分享的內容。',
  pages: '個頁面',
  openPage: '開啟頁面',
  openFolder: '開啟資料夾',
  folderLabel: '資料夾',
  allPages: '全部',
  close: '關閉',
  previous: '上一頁',
  next: '下一頁',
};

const EN: Copy = {
  brand: 'NexTore Designer',
  brandSub: 'Made by Nexify',
  previewOnly: 'Preview only',
  downloadable: 'Downloadable',
  loading: 'Opening the shared document',
  loadingHint: 'Large files can take a few seconds.',
  invalidTitle: 'This link is no longer available',
  invalidBody: 'The sender may have revoked it, or it has expired. Ask them for a new link.',
  expiredTitle: 'This link has expired',
  expiredBody: 'The link passed the expiry the sender set. Ask them for a new link.',
  restrictedTitle: 'This link needs extra verification',
  restrictedBody: 'This share has a password or an audience restriction, so it opens in NexTore.',
  openInNextore: 'Open in NexTore',
  openFailedTitle: 'Cannot open right now',
  openFailedBody: 'The share service did not answer. Please try again in a moment.',
  retry: 'Reload',
  download: 'Download file',
  expires: 'Valid until',
  unsupported: 'This file type cannot be previewed in the browser.',
  empty: 'This folder has nothing to show yet.',
  pages: 'pages',
  openPage: 'Open page',
  openFolder: 'Open folder',
  folderLabel: 'Folder',
  allPages: 'All',
  close: 'Close',
  previous: 'Previous',
  next: 'Next',
};

type View =
  | { status: 'loading' }
  | { status: 'ready'; data: NextorePublicShareDescriptor }
  | { status: 'error'; code: string; fallbackUrl: string | null };

type TrailEntry = { id: number; name: string; items: NextorePublicShareItem[] };

function readKey(): string {
  if (typeof window === 'undefined') return '';
  return new URLSearchParams(window.location.search).get('key') ?? '';
}

function pickCopy(): Copy {
  if (typeof navigator === 'undefined') return ZH;
  return navigator.language.toLowerCase().startsWith('en') ? EN : ZH;
}

function formatDate(value: string | null, locale: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

function extensionOf(fileName: string): string {
  const index = fileName.lastIndexOf('.');
  return index > 0 ? fileName.slice(index + 1).toLowerCase() : '';
}

function titleOf(fileName: string): string {
  const index = fileName.lastIndexOf('.');
  return index > 0 ? fileName.slice(0, index) : fileName;
}

function kindOf(fileName: string | null): 'pdf' | 'html' | 'image' | 'other' {
  const extension = extensionOf(fileName ?? '');
  if (extension === 'pdf') return 'pdf';
  if (extension === 'html' || extension === 'htm') return 'html';
  if (['png', 'jpeg', 'jpg', 'webp', 'gif', 'svg'].includes(extension)) return 'image';
  return 'other';
}

function viewerUrl(contentUrl: string, fileName: string | null): string {
  // Keep the browser's own PDF toolbar: readers use it for page jumps, zoom and
  // printing. Only the initial view is set, so the page fits the frame width.
  if (kindOf(fileName) !== 'pdf') return contentUrl;
  return contentUrl + '#view=FitH';
}

function frameProps(fileName: string | null) {
  // Untrusted document HTML runs in an opaque origin so it can never touch the
  // Designer's storage. PDFs stay unsandboxed: the built-in viewer is a plugin
  // frame and will not render inside a sandbox.
  return kindOf(fileName) === 'html'
    ? { sandbox: 'allow-scripts allow-popups allow-forms' }
    : {};
}

export function PublicSharePage() {
  const copy = useMemo(pickCopy, []);
  const locale = typeof navigator === 'undefined' ? 'zh-Hant' : navigator.language;
  const key = useMemo(readKey, []);
  const [view, setView] = useState<View>({ status: 'loading' });
  const [trail, setTrail] = useState<TrailEntry[]>([]);
  const [openItem, setOpenItem] = useState<NextorePublicShareItem | null>(null);
  const [folderError, setFolderError] = useState<string | null>(null);

  useEffect(() => {
    if (!key) {
      setView({ status: 'error', code: 'invalid_key', fallbackUrl: null });
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch('/api/public-share/' + encodeURIComponent(key), {
          headers: { accept: 'application/json' },
        });
        const payload = await response.json().catch(() => null) as
          | (Partial<NextorePublicShareDescriptor> & { error?: string; fallbackUrl?: string })
          | null;
        if (cancelled) return;
        if (response.ok && payload) {
          const kind = payload.kind === 'folder' ? 'folder' : 'file';
          setView({
            status: 'ready',
            data: {
              kind,
              fileName: typeof payload.fileName === 'string' ? payload.fileName : null,
              previewOnly: payload.previewOnly !== false,
              expiresAt: typeof payload.expiresAt === 'string' ? payload.expiresAt : null,
              contentUrl: typeof payload.contentUrl === 'string' ? payload.contentUrl : null,
              items: Array.isArray(payload.items) ? payload.items : [],
            },
          });
          return;
        }
        setView({
          status: 'error',
          code: typeof payload?.error === 'string' ? payload.error : 'share_unavailable',
          fallbackUrl: typeof payload?.fallbackUrl === 'string' ? payload.fallbackUrl : null,
        });
      } catch {
        if (!cancelled) setView({ status: 'error', code: 'network', fallbackUrl: null });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [key]);

  const rootItems = view.status === 'ready' ? view.data.items : [];
  const currentItems = trail.length > 0 ? trail[trail.length - 1]!.items : rootItems;

  const openFolder = useCallback(async (item: NextorePublicShareItem) => {
    if (!item.childrenUrl) return;
    setFolderError(null);
    try {
      const response = await fetch(item.childrenUrl, { headers: { accept: 'application/json' } });
      const payload = await response.json().catch(() => null) as
        | Partial<NextorePublicShareDescriptor>
        | null;
      if (!response.ok || !payload) {
        setFolderError('folder_unavailable');
        return;
      }
      setTrail((current) => [
        ...current,
        {
          id: item.id,
          name: item.name,
          items: Array.isArray(payload.items) ? payload.items : [],
        },
      ]);
    } catch {
      setFolderError('folder_unavailable');
    }
  }, []);

  const step = useCallback((delta: number) => {
    setOpenItem((current) => {
      if (!current) return current;
      const index = currentItems.findIndex((entry) => entry.id === current.id);
      if (index < 0) return current;
      const next = index + delta;
      return next < 0 || next >= currentItems.length ? current : currentItems[next]!;
    });
  }, [currentItems]);

  useEffect(() => {
    if (!openItem) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpenItem(null);
        return;
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        step(1);
        return;
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        step(-1);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [openItem, step]);

  const expiryLabel = view.status === 'ready' ? formatDate(view.data.expiresAt, locale) : null;
  const isFolder = view.status === 'ready' && view.data.kind === 'folder';
  const openIndex = openItem ? currentItems.findIndex((entry) => entry.id === openItem.id) : -1;

  return (
    <div className={styles.shell}>
      <a className={styles.skip} href="#share-document">{copy.brand}</a>

      <header className={styles.header}>
        <div className={styles.brand}>
          <span className={styles.mark} aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M4 15 12 4l8 11-8 5z" strokeLinejoin="round" />
              <path d="M8 20h8" strokeLinecap="round" />
            </svg>
          </span>
          <span className={styles.brandText}>
            <span className={styles.brandName}>{copy.brand}</span>
            <span className={styles.brandSub}>{copy.brandSub}</span>
          </span>
        </div>

        {view.status === 'ready' ? (
          <div className={styles.headMeta}>
            <span className={styles.fileName} title={view.data.fileName ?? undefined}>
              {view.data.fileName ?? ''}
            </span>
            {isFolder ? (
              <>
                <span aria-hidden="true">·</span>
                <span className={styles.expiry}>{currentItems.length} {copy.pages}</span>
              </>
            ) : null}
            {expiryLabel ? (
              <>
                <span aria-hidden="true">·</span>
                <span className={styles.expiry}>{copy.expires} {expiryLabel}</span>
              </>
            ) : null}
            {!view.data.previewOnly && !isFolder && view.data.contentUrl ? (
              <a
                className={styles.downloadAction}
                href={view.data.contentUrl}
                download={view.data.fileName ?? undefined}
              >
                {copy.download}
              </a>
            ) : null}
            <span className={view.data.previewOnly ? styles.chip : styles.chipStrong}>
              {view.data.previewOnly ? copy.previewOnly : copy.downloadable}
            </span>
          </div>
        ) : null}
      </header>

      <main className={styles.main} id="share-document">
        {view.status === 'loading' ? (
          <div className={styles.sheet}>
            <div className={styles.state} role="status" aria-live="polite">
              <div className={styles.sheetSkeleton} aria-hidden="true" />
              <p className={styles.stateTitle}>{copy.loading}</p>
              <p className={styles.stateBody}>{copy.loadingHint}</p>
            </div>
          </div>
        ) : null}

        {view.status === 'error' ? (
          <div className={styles.sheet}>
            <div className={styles.state} role="alert">
              <span className={styles.stateIcon} aria-hidden="true">!</span>
              <h1 className={styles.stateTitle}>
                {view.code === 'share_expired'
                  ? copy.expiredTitle
                  : view.code === 'share_needs_password' || view.code === 'share_restricted'
                    ? copy.restrictedTitle
                    : view.code === 'network' || view.code === 'share_unavailable'
                      ? copy.openFailedTitle
                      : copy.invalidTitle}
              </h1>
              <p className={styles.stateBody}>
                {view.code === 'share_expired'
                  ? copy.expiredBody
                  : view.code === 'share_needs_password' || view.code === 'share_restricted'
                    ? copy.restrictedBody
                    : view.code === 'network' || view.code === 'share_unavailable'
                      ? copy.openFailedBody
                      : copy.invalidBody}
              </p>
              <div className={styles.stateActions}>
                {view.fallbackUrl ? (
                  <a className={styles.primaryAction} href={view.fallbackUrl} rel="noreferrer noopener">
                    {copy.openInNextore}
                  </a>
                ) : null}
                <button type="button" className={styles.secondaryAction} onClick={() => window.location.reload()}>
                  {copy.retry}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {view.status === 'ready' && isFolder ? (
          <div className={styles.index}>
            <div className={styles.crumbs}>
              <button
                type="button"
                className={styles.crumb}
                onClick={() => setTrail([])}
                disabled={trail.length === 0}
              >
                {copy.allPages}
              </button>
              {trail.map((entry, index) => (
                <span key={entry.id} className={styles.crumbGroup}>
                  <span className={styles.crumbSep} aria-hidden="true">/</span>
                  <button
                    type="button"
                    className={styles.crumb}
                    onClick={() => setTrail((current) => current.slice(0, index + 1))}
                    disabled={index === trail.length - 1}
                  >
                    {entry.name}
                  </button>
                </span>
              ))}
            </div>

            {folderError ? (
              <p className={styles.folderError} role="alert">{copy.openFailedBody}</p>
            ) : null}

            {currentItems.length === 0 ? (
              <div className={styles.state}>
                <p className={styles.stateTitle}>{copy.empty}</p>
                <p className={styles.stateBody}>{trail.length ? trail[trail.length - 1]!.name : view.data.fileName}</p>
              </div>
            ) : (
              <div className={styles.grid}>
                {currentItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={item.kind === 'folder' ? styles.cardFolder : styles.card}
                    onClick={() => {
                      if (item.kind === 'folder') void openFolder(item);
                      else setOpenItem(item);
                    }}
                  >
                    <span className={styles.cardKind} data-kind={item.kind === 'folder' ? 'folder' : kindOf(item.name)} aria-hidden="true">
                      {item.kind === 'folder' ? 'DIR' : (extensionOf(item.name).toUpperCase() || 'FILE')}
                    </span>
                    <span className={styles.cardTitle}>
                      {item.kind === 'folder' ? item.name : titleOf(item.name)}
                    </span>
                    <span className={styles.cardMeta}>
                      {item.kind === 'folder' ? copy.folderLabel : item.name}
                      <span className={styles.cardAction}>
                        {item.kind === 'folder' ? copy.openFolder : copy.openPage}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : null}

        {view.status === 'ready' && !isFolder ? (
          <div className={styles.sheet}>
            {kindOf(view.data.fileName) === 'other' || !view.data.contentUrl ? (
              <div className={styles.state}>
                <p className={styles.stateTitle}>{copy.unsupported}</p>
                <p className={styles.stateBody}>{view.data.fileName}</p>
              </div>
            ) : (
              <iframe
                className={styles.frame}
                src={viewerUrl(view.data.contentUrl, view.data.fileName)}
                title={view.data.fileName ?? copy.brand}
                {...frameProps(view.data.fileName)}
                referrerPolicy="no-referrer"
              />
            )}
          </div>
        ) : null}
      </main>

      {openItem ? (
        <div className={styles.viewer} role="dialog" aria-modal="true" aria-label={openItem.name}>
          <div className={styles.viewerBar}>
            <span className={styles.viewerTitle}>{openItem.name}</span>
            <div className={styles.viewerNav}>
              <button
                type="button"
                className={styles.navButton}
                onClick={() => step(-1)}
                disabled={openIndex <= 0}
              >
                {copy.previous}
              </button>
              <button
                type="button"
                className={styles.navButton}
                onClick={() => step(1)}
                disabled={openIndex < 0 || openIndex >= currentItems.length - 1}
              >
                {copy.next}
              </button>
              <button
                type="button"
                className={styles.navButton}
                onClick={() => setOpenItem(null)}
                aria-label={copy.close}
              >
                ×
              </button>
            </div>
          </div>
          <iframe
            className={styles.viewerFrame}
            src={viewerUrl(openItem.contentUrl ?? '', openItem.name)}
            title={openItem.name}
            {...frameProps(openItem.name)}
            referrerPolicy="no-referrer"
          />
        </div>
      ) : null}
    </div>
  );
}
