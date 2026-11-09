// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { resolveSettingsSectionForEdition } from '../src/components/SettingsDialog';

describe('settings section edition gating', () => {
  it('folds disabled edition sections into General', () => {
    expect(resolveSettingsSectionForEdition('execution', 'nextore', false)).toBe('general');
    expect(resolveSettingsSectionForEdition('media', 'nextore', false)).toBe('general');
    expect(resolveSettingsSectionForEdition('integrations', 'nextore', false)).toBe('general');
    expect(resolveSettingsSectionForEdition('composio', 'nextore', false)).toBe('general');
  });

  it('keeps an enabled section and upstream behaviour intact', () => {
    expect(resolveSettingsSectionForEdition('memory', 'nextore', false)).toBe('memory');
    expect(resolveSettingsSectionForEdition('about', 'nextore', false)).toBe('about');
    expect(resolveSettingsSectionForEdition('execution', 'upstream', true)).toBe('execution');
  });

  it('folds Labs into General when OD Next is disabled', () => {
    expect(resolveSettingsSectionForEdition('labs', 'upstream', false)).toBe('general');
  });
});
