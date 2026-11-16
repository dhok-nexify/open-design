// Downstream overlay merge for locale dictionaries.
//
// Upstream owns `apps/web/src/i18n/locales/*` and names the product directly in
// its copy. This fork ships a different product name, so the brand literals are
// rewritten to the `{brandName}` slot at load time instead of editing the
// upstream files. That keeps every sync free of translation conflicts: upstream
// copy updates arrive untouched, and downstream keys live in ./locales/*.

import type { BaseDict, Dict } from '../types';
import type { NextoreDict } from './types';

/** Downstream values: all downstream keys, plus literal upstream overrides. */
export type LocaleOverlay = NextoreDict & Partial<BaseDict>;

// A negative lookbehind keeps social handles such as @OpenDesignHQ intact.
const PRODUCT_NAME_LITERALS = [/(?<!@)OpenDesign/g, /Open Design/g];

export function maskBrandName(message: string): string {
  return PRODUCT_NAME_LITERALS.reduce(
    (text, pattern) => text.replace(pattern, '{brandName}'),
    message,
  );
}

export function withOverlay(
  base: BaseDict,
  overlay: LocaleOverlay,
  brandMaskedKeys: readonly (keyof BaseDict)[],
): Dict {
  const merged: Record<string, string> = { ...base };
  for (const key of brandMaskedKeys) {
    const value = merged[key];
    if (typeof value === 'string') merged[key] = maskBrandName(value);
  }
  for (const [key, value] of Object.entries(overlay)) {
    if (typeof value === 'string') merged[key] = value;
  }
  // `base` supplies every BaseDict key and `overlay` supplies every NextoreDict
  // key, so the result is complete by construction; the double assertion is the
  // narrowest way to tell the compiler, which only sees an index signature.
  return merged as unknown as Dict;
}
