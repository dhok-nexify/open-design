'use client';

import { useEffect, useState } from 'react';

import DOMPurify from 'dompurify';

import { renderMarkdownToSafeHtml } from '../artifacts/markdown';
import styles from './PublicSharePage.module.css';

type Format = 'markdown' | 'docx';

/**
 * Word tables are sized by their content, and the reading surface is a narrow
 * column. Markdown tables already arrive inside a scroll wrapper; mammoth's do
 * not, so a wide table would push the whole page sideways. Wrapping keeps the
 * overflow inside the table itself, the same way the markdown path does.
 */
function wrapWordTables(html: string): string {
  if (!html.includes('<table')) return html;
  const holder = document.createElement('div');
  holder.innerHTML = html;
  for (const table of Array.from(holder.querySelectorAll('table'))) {
    // A nested table already scrolls inside its parent cell.
    if (table.parentElement?.closest('table')) continue;
    const scroll = document.createElement('div');
    scroll.className = styles.tableScroll ?? '';
    table.replaceWith(scroll);
    scroll.append(table);
  }
  return holder.innerHTML;
}

/**
 * Renders a shared rich document (Markdown or Word) as sanitised HTML.
 *
 * The document arrives through a public share link, so it is untrusted: HTML is
 * produced by micromark (raw HTML stays escaped) or by mammoth, and everything is
 * passed through DOMPurify before it reaches the DOM. mammoth is imported on
 * demand so the converter never ships to readers who only open HTML or PDF.
 */
export function ShareRichDocumentView({
  url,
  format,
  labels,
}: {
  url: string;
  format: Format;
  labels: { loading: string; failed: string };
}) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [html, setHtml] = useState('');

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    void (async () => {
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error('document_unavailable');
        let raw: string;
        if (format === 'markdown') {
          raw = renderMarkdownToSafeHtml(await response.text());
        } else {
          const mammoth = await import('mammoth');
          const buffer = await response.arrayBuffer();
          const result = await mammoth.convertToHtml({ arrayBuffer: buffer });
          raw = result.value;
        }
        if (cancelled) return;
        const safe = DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } });
        setHtml(format === 'docx' ? wrapWordTables(safe) : safe);
        setState('ready');
      } catch {
        if (!cancelled) setState('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [format, url]);

  if (state === 'loading') {
    return (
      <div className={styles.state} role="status" aria-live="polite">
        <p className={styles.stateBody}>{labels.loading}</p>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className={styles.state} role="alert">
        <p className={styles.stateBody}>{labels.failed}</p>
      </div>
    );
  }

  return <div className={styles.prose} dangerouslySetInnerHTML={{ __html: html }} />;
}
