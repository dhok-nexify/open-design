import { describe, expect, it } from 'vitest';

import { maskBrandName, withOverlay, type LocaleOverlay } from '../../src/i18n/nextore/merge';
import { LOCALES, type BaseDict, type Locale } from '../../src/i18n/types';

type OverlayModule = Record<string, unknown>;

async function mergedDict(locale: Locale): Promise<Record<string, string>> {
  const [baseModule, overlayModule] = await Promise.all([
    import(`../../src/i18n/locales/${locale}.ts`),
    import(`../../src/i18n/nextore/locales/${locale}.ts`),
  ]);
  const base = Object.values(baseModule).find(
    (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value),
  ) as BaseDict | undefined;
  const entries = Object.values(overlayModule);
  const overlay = entries.find(
    (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value),
  ) as LocaleOverlay | undefined;
  const brandMaskedKeys = entries.find((value) => Array.isArray(value)) as string[] | undefined;
  if (!base || !overlay || !brandMaskedKeys) throw new Error(`no dictionary export for ${locale}`);
  return withOverlay(base, overlay, brandMaskedKeys as (keyof BaseDict)[]) as unknown as Record<string, string>;
}

async function overlayParts(locale: Locale): Promise<{
  values: Record<string, string>;
  brandMaskedKeys: string[];
}> {
  const module = (await import(`../../src/i18n/nextore/locales/${locale}.ts`)) as OverlayModule;
  const entries = Object.values(module);
  const values = entries.find(
    (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value),
  ) as Record<string, string> | undefined;
  const brandMaskedKeys = entries.find((value) => Array.isArray(value)) as string[] | undefined;
  if (!values || !brandMaskedKeys) throw new Error(`incomplete overlay module for ${locale}`);
  return { values, brandMaskedKeys };
}

describe('downstream i18n overlay', () => {
  it('keeps every locale key-complete against English', async () => {
    const englishKeys = Object.keys(await mergedDict('en')).sort();
    for (const locale of LOCALES) {
      const dict = await mergedDict(locale);
      expect(Object.keys(dict).sort(), `${locale} key set`).toEqual(englishKeys);
    }
  });

  it('brand-masked keys resolve to the {brandName} slot', async () => {
    for (const locale of LOCALES) {
      const dict = await mergedDict(locale);
      const { brandMaskedKeys } = await overlayParts(locale);
      expect(brandMaskedKeys.length, `${locale} brand-masked keys`).toBeGreaterThan(0);
      for (const key of brandMaskedKeys) {
        expect(dict[key], `${locale}.${key}`).toContain('{brandName}');
      }
    }
  });

  it('never ships the downstream product name inside overlay values', async () => {
    for (const locale of LOCALES) {
      const { values } = await overlayParts(locale);
      const offenders = Object.entries(values)
        .filter(([, value]) => value.includes('NexTore Designer'))
        .map(([key]) => key);
      expect(offenders, `${locale} overlay values`).toEqual([]);
    }
  });

  it('keeps social handles out of the brand mask', () => {
    expect(maskBrandName('Follow @OpenDesignHQ for updates')).toBe('Follow @OpenDesignHQ for updates');
    expect(maskBrandName('Open OpenDesign now')).toBe('Open {brandName} now');
    expect(maskBrandName('Open Open Design now')).toBe('Open {brandName} now');
  });
});
