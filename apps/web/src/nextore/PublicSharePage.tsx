'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import type {
  NextorePublicShareDescriptor,
  NextorePublicShareItem,
} from '@open-design/contracts';

import { ShareRichDocumentView } from './ShareRichDocumentView';
import { ShareSheetView } from './ShareSheetView';
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
  previewUnavailable: string;
  sheet: string;
  sheetTruncated: string;
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
  previewUnavailable: '此格式沒有線上預覽，請向分享者索取可下載的版本。',
  sheet: '工作表',
  sheetTruncated: '僅顯示前 200 列、30 欄。',
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
  previewUnavailable: 'This format has no online preview. Ask the sender for a downloadable copy.',
  sheet: 'Sheets',
  sheetTruncated: 'Showing the first 200 rows and 30 columns only.',
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

export function shareFileKind(fileName: string | null): 'pdf' | 'html' | 'image' | 'markdown' | 'docx' | 'sheet' | 'text' | 'other' {
  const extension = extensionOf(fileName ?? '');
  if (extension === 'pdf') return 'pdf';
  if (extension === 'html' || extension === 'htm') return 'html';
  if (extension === 'md' || extension === 'markdown') return 'markdown';
  if (extension === 'docx') return 'docx';
  if (extension === 'xlsx' || extension === 'xls') return 'sheet';
  if (['png', 'jpeg', 'jpg', 'webp', 'gif', 'svg', 'avif', 'bmp', 'ico'].includes(extension)) return 'image';
  if (
    ['txt', 'css', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'json', 'xml', 'csv', 'yml', 'yaml', 'log']
      .includes(extension)
  ) return 'text';
  return 'other';
}

function viewerUrl(contentUrl: string, fileName: string | null): string {
  // Keep the browser's own PDF toolbar: readers use it for page jumps, zoom and
  // printing. Only the initial view is set, so the page fits the frame width.
  if (shareFileKind(fileName) !== 'pdf') return contentUrl;
  return contentUrl + '#view=FitH';
}

function thumbUrl(item: NextorePublicShareItem): string {
  const url = item.contentUrl ?? '';
  if (shareFileKind(item.name) !== 'pdf') return url;
  // FitH fills the thumbnail width instead of fitting the whole page, which
  // otherwise leaves wide grey bands on both sides of the preview.
  return url + '#page=1&view=FitH&toolbar=0&navpanes=0&statusbar=0';
}

function frameProps(fileName: string | null) {
  // Untrusted document HTML runs in an opaque origin so it can never touch the
  // Designer's storage. PDFs stay unsandboxed: the built-in viewer is a plugin
  // frame and will not render inside a sandbox.
  return shareFileKind(fileName) === 'html'
    ? { sandbox: 'allow-scripts allow-popups allow-forms' }
    : {};
}

function TextPane({ url, name, copy }: { url: string; name: string; copy: Copy }) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [text, setText] = useState('');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(url, { headers: { accept: 'text/plain' } });
        if (!response.ok) throw new Error('text_unavailable');
        const raw = await response.text();
        if (cancelled) return;
        // A shared document is read, not downloaded: cap the render so a 5 MB
        // log cannot freeze the tab.
        setText(raw.length > 200_000 ? raw.slice(0, 200_000) + '\n\n…' : raw);
        setState('ready');
      } catch {
        if (!cancelled) setState('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (state === 'loading') {
    return <div className={styles.state} role="status" aria-live="polite"><p className={styles.stateBody}>{copy.loading}</p></div>;
  }
  if (state === 'error') {
    return <div className={styles.state} role="alert"><p className={styles.stateBody}>{copy.openFailedBody}</p></div>;
  }
  return <pre className={styles.textPane} aria-label={name}>{text}</pre>;
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
  // Guards against a page that opens a dozen documents at once: past eight
  // entries the cards fall back to type + name only.
  const showThumbs = currentItems.length <= 8 && currentItems.some((item) => item.kind === 'file');

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
  const previewOnly = view.status === 'ready' ? view.data.previewOnly : true;
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
                {currentItems.map((item) => {
                  const isFolder = item.kind === 'folder';
                  const open = () => {
                    if (isFolder) void openFolder(item);
                    else setOpenItem(item);
                  };
                  return (
                    <div
                      key={item.id}
                      role="button"
                      tabIndex={0}
                      className={isFolder ? styles.cardFolder : styles.card}
                      onClick={open}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          open();
                        }
                      }}
                    >
                      {!isFolder && showThumbs && item.contentUrl ? (
                        <span className={styles.cardThumb} aria-hidden="true">
                          {shareFileKind(item.name) === 'image' ? (
                            <img
                              className={styles.cardThumbImg}
                              src={item.contentUrl}
                              alt=""
                              loading="lazy"
                            />
                          ) : shareFileKind(item.name) === 'text' || shareFileKind(item.name) === 'markdown' || shareFileKind(item.name) === 'docx' || shareFileKind(item.name) === 'sheet' || shareFileKind(item.name) === 'other' ? (
                            <span className={styles.cardThumbText}>
                              <span className={styles.cardThumbExt}>
                                {extensionOf(item.name).toUpperCase() || 'FILE'}
                              </span>
                            </span>
                          ) : (
                            <iframe
                              className={styles.cardThumbFrame}
                              src={thumbUrl(item)}
                              tabIndex={-1}
                              aria-hidden="true"
                              title=""
                              scrolling="no"
                              {...frameProps(item.name)}
                            />
                          )}
                        </span>
                      ) : null}
                      <span className={styles.cardKind} data-kind={isFolder ? 'folder' : shareFileKind(item.name)} aria-hidden="true">
                        {isFolder ? 'DIR' : (extensionOf(item.name).toUpperCase() || 'FILE')}
                      </span>
                      <span className={styles.cardTitle}>
                        {isFolder ? item.name : titleOf(item.name)}
                      </span>
                      <span className={styles.cardMeta}>
                        {isFolder ? copy.folderLabel : item.name}
                        <span className={styles.cardAction}>
                          {isFolder ? copy.openFolder : copy.openPage}
                        </span>
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : null}

        {view.status === 'ready' && !isFolder ? (
          <div className={styles.sheet}>
            {!view.data.contentUrl ? (
              <div className={styles.state}>
                <p className={styles.stateTitle}>{copy.unsupported}</p>
                <p className={styles.stateBody}>{view.data.fileName}</p>
              </div>
            ) : shareFileKind(view.data.fileName) === 'other' ? (
              <div className={styles.state}>
                <p className={styles.stateTitle}>{copy.unsupported}</p>
                <p className={styles.stateBody}>{view.data.fileName}</p>
                {!view.data.previewOnly ? (
                  <a
                    className={styles.primaryAction}
                    href={view.data.contentUrl}
                    download={view.data.fileName ?? undefined}
                  >
                    {copy.download}
                  </a>
                ) : (
                  <p className={styles.stateBody}>{copy.previewUnavailable}</p>
                )}
              </div>
            ) : shareFileKind(view.data.fileName) === 'markdown' || shareFileKind(view.data.fileName) === 'docx' ? (
              <ShareRichDocumentView
                url={view.data.contentUrl}
                format={shareFileKind(view.data.fileName) as 'markdown' | 'docx'}
                labels={{ loading: copy.loading, failed: copy.openFailedBody }}
              />
            ) : shareFileKind(view.data.fileName) === 'sheet' ? (
              <ShareSheetView
                url={view.data.contentUrl}
                labels={{
                  loading: copy.loading,
                  failed: copy.openFailedBody,
                  sheet: copy.sheet,
                  truncated: copy.sheetTruncated,
                }}
              />
            ) : shareFileKind(view.data.fileName) === 'text' ? (
              <TextPane url={view.data.contentUrl} name={view.data.fileName ?? copy.brand} copy={copy} />
            ) : shareFileKind(view.data.fileName) === 'image' ? (
              <div className={styles.imagePane}>
                <img src={view.data.contentUrl} alt={view.data.fileName ?? copy.brand} />
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
          {shareFileKind(openItem.name) === 'other' || !openItem.contentUrl ? (
            <div className={styles.viewerState}>
              <p className={styles.stateTitle}>{copy.unsupported}</p>
              <p className={styles.stateBody}>{openItem.name}</p>
              {!previewOnly && openItem.contentUrl ? (
                <a className={styles.primaryAction} href={openItem.contentUrl} download={openItem.name}>
                  {copy.download}
                </a>
              ) : (
                <p className={styles.stateBody}>{copy.previewUnavailable}</p>
              )}
            </div>
          ) : shareFileKind(openItem.name) === 'markdown' || shareFileKind(openItem.name) === 'docx' ? (
            <ShareRichDocumentView
              url={openItem.contentUrl}
              format={shareFileKind(openItem.name) as 'markdown' | 'docx'}
              labels={{ loading: copy.loading, failed: copy.openFailedBody }}
            />
          ) : shareFileKind(openItem.name) === 'sheet' ? (
            <ShareSheetView
              url={openItem.contentUrl}
              labels={{
                loading: copy.loading,
                failed: copy.openFailedBody,
                sheet: copy.sheet,
                truncated: copy.sheetTruncated,
              }}
            />
          ) : shareFileKind(openItem.name) === 'text' ? (
            <TextPane url={openItem.contentUrl} name={openItem.name} copy={copy} />
          ) : shareFileKind(openItem.name) === 'image' ? (
            <div className={styles.imagePane}>
              <img src={openItem.contentUrl} alt={openItem.name} />
            </div>
          ) : (
            <iframe
              className={styles.viewerFrame}
              src={viewerUrl(openItem.contentUrl, openItem.name)}
              title={openItem.name}
              {...frameProps(openItem.name)}
              referrerPolicy="no-referrer"
            />
          )}
        </div>
      ) : null}
    </div>
  );
}
