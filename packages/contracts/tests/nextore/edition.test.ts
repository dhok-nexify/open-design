import { describe, expect, it } from 'vitest';
import {
  NEXTORE_DISABLED_FEATURES,
  isNextoreFeatureEnabled,
  resolveEdition,
} from '../../src/nextore/edition.js';

describe('resolveEdition', () => {
  it('keeps upstream behavior when the edition is unset or empty', () => {
    expect(resolveEdition(undefined)).toBe('upstream');
    expect(resolveEdition(null)).toBe('upstream');
    expect(resolveEdition('')).toBe('upstream');
    expect(resolveEdition('  ')).toBe('upstream');
  });

  it('accepts the supported edition values and trims whitespace', () => {
    expect(resolveEdition('upstream')).toBe('upstream');
    expect(resolveEdition(' nextore ')).toBe('nextore');
  });

  it('rejects unknown values so an operator typo cannot silently change behavior', () => {
    expect(() => resolveEdition('nexstore')).toThrow(
      'Unsupported edition "nexstore". Expected one of: upstream, nextore.',
    );
  });
});

describe('isNextoreFeatureEnabled', () => {
  it('leaves every feature enabled in the upstream edition', () => {
    for (const feature of NEXTORE_DISABLED_FEATURES) {
      expect(isNextoreFeatureEnabled('upstream', feature)).toBe(true);
    }
  });

  it('disables every declared feature in the NexTore edition', () => {
    for (const feature of NEXTORE_DISABLED_FEATURES) {
      expect(isNextoreFeatureEnabled('nextore', feature)).toBe(false);
    }
  });
});
