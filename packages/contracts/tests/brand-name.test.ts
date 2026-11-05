import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PRODUCT_BRAND_NAME,
  applyProductBrandName,
} from '../src/prompts/brand-name.js';
import { composeSystemPrompt } from '../src/prompts/system.js';

const NAME = DEFAULT_PRODUCT_BRAND_NAME;

describe('applyProductBrandName', () => {
  it('keeps the default build byte-identical when no name is supplied', () => {
    const text = `Start ${NAME} now.`;
    expect(applyProductBrandName(text)).toBe(text);
    expect(applyProductBrandName(text, '')).toBe(text);
    expect(applyProductBrandName(text, '   ')).toBe(text);
    expect(applyProductBrandName(text, NAME)).toBe(text);
  });

  it('replaces every pinned occurrence with the configured name', () => {
    const text = `A ${NAME} run: ${NAME} owns state.`;
    expect(applyProductBrandName(text, 'Contoso Studio')).toBe(
      'A Contoso Studio run: Contoso Studio owns state.',
    );
  });

  it('inserts a name containing regex metacharacters literally', () => {
    expect(applyProductBrandName(NAME, 'A$B.*(C)')).toBe('A$B.*(C)');
  });

  it('trims the configured name', () => {
    expect(applyProductBrandName(NAME, '  Contoso  ')).toBe('Contoso');
  });
});

describe('composeSystemPrompt — brand name', () => {
  it('substitutes the product name through the legacy composition path', () => {
    const prompt = composeSystemPrompt({ brandName: 'Contoso Studio' });

    expect(prompt).toContain('Contoso Studio');
    expect(prompt).not.toContain(NAME);
  });

  it('leaves the prompt unchanged when the brand name is omitted', () => {
    const prompt = composeSystemPrompt({});

    expect(prompt).toContain(NAME);
  });
});
