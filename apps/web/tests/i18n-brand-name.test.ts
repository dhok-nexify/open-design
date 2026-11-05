import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { getBrandName, interpolateMessage, setBrandName } from '../src/i18n';

const I18N_DIR = path.resolve(process.cwd(), 'src/i18n');

function localeFiles(): string[] {
  const locales = readdirSync(path.join(I18N_DIR, 'locales'))
    .filter((name) => name.endsWith('.ts'))
    .map((name) => path.join(I18N_DIR, 'locales', name));
  const content = readdirSync(I18N_DIR)
    .filter((name) => name.startsWith('content') && name.endsWith('.ts'))
    .map((name) => path.join(I18N_DIR, name));
  return [...locales, ...content];
}

afterEach(() => {
  setBrandName(null);
});

describe('i18n brand name', () => {
  it('no locale hardcodes the product name', () => {
    const offenders = localeFiles().filter((file) =>
      readFileSync(file, 'utf8').includes('NexTore Designer'),
    );
    expect(offenders.map((file) => path.relative(process.cwd(), file))).toEqual([]);
  });

  it('interpolates the default brand name without explicit vars', () => {
    expect(getBrandName()).toBe('NexTore Designer');
    expect(interpolateMessage('Open {brandName}')).toBe('Open NexTore Designer');
  });

  it('uses the branding name after setBrandName', () => {
    setBrandName('Acme Design');
    expect(getBrandName()).toBe('Acme Design');
    expect(interpolateMessage('Open {brandName}')).toBe('Open Acme Design');
  });

  it('lets explicit vars win and falls back on blank names', () => {
    setBrandName('   ');
    expect(getBrandName()).toBe('NexTore Designer');
    expect(interpolateMessage('Open {brandName}', { brandName: 'Override' })).toBe('Open Override');
  });
});
