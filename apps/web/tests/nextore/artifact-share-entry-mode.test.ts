import { describe, expect, it } from 'vitest';

import { artifactShareEntryMode } from '../../src/nextore/project-actions';

describe('artifact share entry mode', () => {
  it('opens the artifact dialog for a manager with share links enabled', () => {
    expect(artifactShareEntryMode('nextore', { canManage: true, shareLinksEnabled: true })).toBe('dialog');
    // The flag defaults on unless the module says otherwise.
    expect(artifactShareEntryMode('nextore', { canManage: true })).toBe('dialog');
  });

  it('hides the entry when share links are switched off', () => {
    expect(artifactShareEntryMode('nextore', { canManage: true, shareLinksEnabled: false })).toBe('hidden');
  });

  it('hides the entry for a member who cannot manage the project', () => {
    expect(artifactShareEntryMode('nextore', { canManage: false, shareLinksEnabled: true })).toBe('hidden');
    // An access read that has not landed yet is not proof of the right.
    expect(artifactShareEntryMode('nextore', null)).toBe('hidden');
  });

  it('keeps the legacy menu for other editions', () => {
    expect(artifactShareEntryMode(undefined, null)).toBe('menu');
    expect(artifactShareEntryMode('upstream', null)).toBe('menu');
  });
});
