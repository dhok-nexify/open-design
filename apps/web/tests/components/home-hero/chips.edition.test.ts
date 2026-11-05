import { afterEach, describe, expect, it, vi } from 'vitest';

// features.ts resolves the edition once at import time, so each case re-imports
// the chips module after setting the public env var.
describe('home hero chips — NexTore edition gating', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('keeps image and figma upstream', async () => {
    vi.stubEnv('NEXT_PUBLIC_OD_EDITION', 'upstream');
    vi.resetModules();
    const chips = await import('../../../src/components/home-hero/chips');

    expect(chips.orderedCreateChips().map((chip) => chip.id)).toContain('image');
    expect(chips.chipsForGroup('migrate').map((chip) => chip.id)).toContain('figma');
  });

  it('hides image and figma in the NexTore edition', async () => {
    vi.stubEnv('NEXT_PUBLIC_OD_EDITION', 'nextore');
    vi.resetModules();
    const chips = await import('../../../src/components/home-hero/chips');

    const createIds = chips.orderedCreateChips().map((chip) => chip.id);
    expect(createIds).not.toContain('image');
    expect(createIds).toContain('prototype');
    expect(createIds).toContain('deck');

    const migrateIds = chips.chipsForGroup('migrate').map((chip) => chip.id);
    expect(migrateIds).not.toContain('figma');
    expect(migrateIds).toContain('template');
  });
});
