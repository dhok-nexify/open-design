// @vitest-environment jsdom
/**
 * The share page must recognise every format the Designer can produce. The
 * artifact pipeline emits html/jsx/tsx/css/svg/md, snapshots are pdf, uploads can
 * be images, Word files or other documents, so a missed extension shows as
 * "cannot preview".
 */
import { describe, expect, it } from 'vitest';

import { shareFileKind } from '../../src/nextore/PublicSharePage';

describe('shareFileKind', () => {
  it('routes the artifact formats the Designer produces', () => {
    expect(shareFileKind('landing.html')).toBe('html');
    expect(shareFileKind('page.htm')).toBe('html');
    expect(shareFileKind('blog-post.pdf')).toBe('pdf');
    expect(shareFileKind('logo.svg')).toBe('image');
    expect(shareFileKind('photo.webp')).toBe('image');
    expect(shareFileKind('notes.md')).toBe('markdown');
    expect(shareFileKind('readme.markdown')).toBe('markdown');
    expect(shareFileKind('theme.css')).toBe('text');
    expect(shareFileKind('App.tsx')).toBe('text');
    expect(shareFileKind('card.jsx')).toBe('text');
    expect(shareFileKind('data.json')).toBe('text');
    expect(shareFileKind('report.csv')).toBe('text');
  });

  it('routes word documents to the converter and leaves binary formats alone', () => {
    expect(shareFileKind('brief.docx')).toBe('docx');
    expect(shareFileKind('budget.xlsx')).toBe('other');
    expect(shareFileKind('deck.pptx')).toBe('other');
    expect(shareFileKind('bundle.zip')).toBe('other');
    expect(shareFileKind('no-extension')).toBe('other');
  });

  it('is case-insensitive and tolerates a missing name', () => {
    expect(shareFileKind('PAGE.HTML')).toBe('html');
    expect(shareFileKind('NOTES.MD')).toBe('markdown');
    expect(shareFileKind(null)).toBe('other');
  });
});
