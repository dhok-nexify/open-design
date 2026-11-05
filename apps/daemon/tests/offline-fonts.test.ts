import { describe, expect, it } from 'vitest';

import { mapToOfflineFontFamily, offlineFontStack } from '../src/brands/offline-fonts.js';

describe('mapToOfflineFontFamily', () => {
  it('keeps whitelist families (case-insensitive)', () => {
    for (const family of [
      'Inter',
      'Inter Tight',
      'Source Serif 4',
      'Playfair Display',
      'Space Grotesk',
      'JetBrains Mono',
      'Noto Sans HK',
      'Noto Serif HK',
      'Noto Sans SC',
      'Noto Serif SC',
    ]) {
      expect(mapToOfflineFontFamily(family), family).toBe(family);
    }
    expect(mapToOfflineFontFamily('  inter  ')).toBe('Inter');
  });

  it('resolves known aliases', () => {
    expect(mapToOfflineFontFamily('Inter Display')).toBe('Inter');
    expect(mapToOfflineFontFamily('Source Serif Pro')).toBe('Source Serif 4');
    expect(mapToOfflineFontFamily('Noto Sans TC')).toBe('Noto Sans HK');
    expect(mapToOfflineFontFamily('Noto Serif TC')).toBe('Noto Serif HK');
    expect(mapToOfflineFontFamily('Playfair')).toBe('Playfair Display');
  });

  it('maps by category', () => {
    expect(mapToOfflineFontFamily('IBM Plex Mono')).toBe('JetBrains Mono');
    expect(mapToOfflineFontFamily('Archivo Black')).toBe('Space Grotesk');
    expect(mapToOfflineFontFamily('Instrument Serif')).toBe('Source Serif 4');
    expect(mapToOfflineFontFamily('Caveat')).toBe('Playfair Display');
    expect(mapToOfflineFontFamily('Plus Jakarta Sans')).toBe('Inter');
    expect(mapToOfflineFontFamily('PingFang SC')).toBe('Noto Sans SC');
    expect(mapToOfflineFontFamily('Microsoft JhengHei')).toBe('Noto Sans HK');
  });

  it('falls back to Inter when nothing is requested', () => {
    expect(mapToOfflineFontFamily('')).toBe('Inter');
    expect(mapToOfflineFontFamily(null)).toBe('Inter');
    expect(mapToOfflineFontFamily(undefined)).toBe('Inter');
  });
});

describe('offlineFontStack', () => {
  it('quotes multi-word families and appends host fallbacks', () => {
    expect(offlineFontStack('Inter Tight')).toBe("'Inter Tight', Inter, system-ui, sans-serif");
    expect(offlineFontStack('JetBrains Mono')).toBe("'JetBrains Mono', ui-monospace, monospace");
  });

  it('maps before building the stack', () => {
    expect(offlineFontStack('IBM Plex Mono')).toBe("'JetBrains Mono', ui-monospace, monospace");
    expect(offlineFontStack(undefined)).toBe('Inter, system-ui, sans-serif');
  });
});
