// Home is deliberately limited to DESIGN output types.
//
// Video, Audio, HyperFrames, Live artifact and Website clone used to be
// first-level Home task types. They were removed from the Home rail so the
// first screen only offers design outputs. The underlying scenario plugins stay
// installed and reachable from the Plugins tab and the composer "+" menu — what
// these tests pin is that the Home catalog no longer names them, so a stale
// persisted composer draft or a re-add cannot silently resurrect a chip the
// product removed.

import { describe, expect, it } from 'vitest';
import {
  CREATE_RAIL_ORDER,
  findChip,
  HOME_HERO_CHIPS,
} from '../../../src/components/home-hero/chips';

const REMOVED_CHIP_IDS = [
  'hyperframes',
  'web-clone',
  'video',
  'audio',
  'live-artifact',
] as const;

describe('Home output types', () => {
  it('offers exactly the five design output types, in product order', () => {
    expect([...CREATE_RAIL_ORDER]).toEqual([
      'prototype',
      'deck',
      'image',
      'document',
      'webgl',
    ]);
  });

  it('keeps the removed task types out of the chip catalog entirely', () => {
    const catalogIds = new Set(HOME_HERO_CHIPS.map((chip) => chip.id));
    for (const id of REMOVED_CHIP_IDS) {
      expect(catalogIds.has(id), id).toBe(false);
      // No catalog entry means a persisted draft naming one of these resolves to
      // nothing and Home falls back to the prompt-only surface instead of
      // re-applying a chip that no longer exists.
      expect(findChip(id), id).toBeUndefined();
    }
  });

  it('leaves the surviving chips routable and the create actions intact', () => {
    for (const chip of HOME_HERO_CHIPS) {
      if (chip.group !== 'create') continue;
      expect(typeof chip.label, chip.id).toBe('string');
      expect(chip.label.length, chip.id).toBeGreaterThan(0);
    }
    // Create-brand-kit is action-only and must stay in the create group as the
    // leading entry of the catalog, not in the rail order.
    expect(HOME_HERO_CHIPS.filter((chip) => chip.group === 'create')[0]?.id)
      .toBe('create-brand-kit');
    expect([...CREATE_RAIL_ORDER]).not.toContain('create-brand-kit');
  });
});
