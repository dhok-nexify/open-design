'use client';

import { useEffect, useMemo, useState } from 'react';

import type { NextorePublicShareDescriptor } from '@open-design/contracts';

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
  neverExpires: string;
  unsupported: string;
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
  neverExpires: '無到期日',
  unsupported: '此檔案格式無法在瀏覽器中預覽。',
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
  neverExpires: 'No expiry',
  unsupported: 'This file type cannot be previewed in the browser.',
};

type View =
  | { status: 'loading' }
  | { status: 'ready'; data: NextorePublicShareDescriptor }
  | { status: 'error'; code: string; fallbackUrl: string | null };

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

function kindOf(fileName: string | null): 'pdf' | 'html' | 'image' | 'other' {
  const name = (fileName ?? '').toLowerCase();
  if (name.endsWith('.pdf')) return 'pdf';
  if (name.endsWith('.html') || name.endsWith('.htm')) return 'html';
  if (/.(png|jpe?g|webp|gif|svg)$/.test(name)) return 'image';
  return 'other';
}

export function PublicSharePage() {
  const copy = useMemo(pickCopy, []);
  const locale = typeof navigator === 'undefined' ? 'zh-Hant' : navigator.language;
  const key = useMemo(readKey, []);
  const [view, setView] = useState<View>({ status: 'loading' });

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
        if (response.ok && payload && typeof payload.contentUrl === 'string') {
          setView({
            status: 'ready',
            data: {
              fileName: typeof payload.fileName === 'string' ? payload.fileName : null,
              previewOnly: payload.previewOnly !== false,
              expiresAt: typeof payload.expiresAt === 'string' ? payload.expiresAt : null,
              contentUrl: payload.contentUrl,
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

  const title = copy.brand;
  const expiryLabel = view.status === 'ready'
    ? formatDate(view.data.expiresAt, locale) ?? copy.neverExpires
    : null;

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
            <span className={styles.brandName}>{title}</span>
            <span className={styles.brandSub}>{copy.brandSub}</span>
          </span>
        </div>
        {view.status === 'ready' ? (
          <span className={view.data.previewOnly ? styles.chip : styles.chipStrong}>
            {view.data.previewOnly ? copy.previewOnly : copy.downloadable}
          </span>
        ) : null}
      </header>

      <main className={styles.main} id="share-document">
        {view.status === 'loading' ? (
          <div className={styles.state} role="status" aria-live="polite">
            <div className={styles.sheetSkeleton} aria-hidden="true" />
            <p className={styles.stateTitle}>{copy.loading}</p>
            <p className={styles.stateBody}>{copy.loadingHint}</p>
          </div>
        ) : null}

        {view.status === 'error' ? (
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
        ) : null}

        {view.status === 'ready' ? (
          <div className={styles.sheet}>
            {kindOf(view.data.fileName) === 'other' ? (
              <div className={styles.state}>
                <p className={styles.stateTitle}>{copy.unsupported}</p>
                <p className={styles.stateBody}>{view.data.fileName}</p>
              </div>
            ) : (
              <iframe
                className={styles.frame}
                src={view.data.contentUrl}
                title={view.data.fileName ?? copy.brand}
                /* Untrusted document HTML runs in an opaque origin so it can never
                   touch the Designer's storage. PDFs must stay unsandboxed:
                   Chrome's built-in viewer is a plugin frame and renders blank
                   inside a sandbox. */
                {...(kindOf(view.data.fileName) === 'html'
                  ? { sandbox: 'allow-scripts allow-popups allow-forms' }
                  : {})}
                referrerPolicy="no-referrer"
              />
            )}
          </div>
        ) : null}
      </main>

      {view.status === 'ready' ? (
        <footer className={styles.footer}>
          <div className={styles.meta}>
            <span className={styles.fileName}>{view.data.fileName ?? ''}</span>
            <span className={styles.dot} aria-hidden="true">·</span>
            <span className={styles.expiry}>
              {view.data.expiresAt ? copy.expires + ' ' + expiryLabel : copy.neverExpires}
            </span>
          </div>
          {!view.data.previewOnly ? (
            <a className={styles.primaryAction} href={view.data.contentUrl} download={view.data.fileName ?? undefined}>
              {copy.download}
            </a>
          ) : null}
        </footer>
      ) : null}
    </div>
  );
}
