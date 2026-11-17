// The Home create rail shares the canonical creation-type catalogue with the
// rest of the product. Edition-disabled types (image, video, audio, hyperframes,
// web-clone, figma) are hidden at render time by `chipsForGroup` /
// `orderedCreateChips`; they are never deleted from the catalogue, so a
// persisted draft that names one still resolves and a later edition can turn the
// feature back on without a data migration. See `chips.edition.test.ts` for the
// edition gate itself.

import { describe, expect, it } from 'vitest';
import {
  CREATE_RAIL_ORDER,
  findChip,
  HOME_HERO_CHIPS,
  HOME_TYPE_ROW_IDS,
  HOME_TYPE_ROW_MORE_IDS,
  orderedCreateChips,
} from '../../../src/components/home-hero/chips';

describe('Home create rail', () => {
  it('keeps the shared catalogue order instead of a Home-only subset', () => {
    for (const id of ['prototype', 'motion-design', 'deck', 'document', 'image', 'webgl']) {
      expect([...CREATE_RAIL_ORDER], id).toContain(id);
      expect(findChip(id), id).toBeDefined();
    }
  });

  it('folds the rail into one inline row plus 更多 without gaps or repeats', () => {
    const folded = [...HOME_TYPE_ROW_IDS, ...HOME_TYPE_ROW_MORE_IDS];
    expect(new Set(folded).size).toBe(folded.length);
    expect([...folded].sort()).toEqual([...CREATE_RAIL_ORDER].sort());
  });

  it('resolves every rail id to a catalog chip', () => {
    expect(orderedCreateChips().map((chip) => chip.id)).toEqual([...CREATE_RAIL_ORDER]);
  });

  it('keeps action-only chips out of the rail', () => {
    // Create-brand-kit is action-only and must stay in the create group as the
    // leading catalogue entry, not in the rail order.
    expect(HOME_HERO_CHIPS.filter((chip) => chip.group === 'create')[0]?.id)
      .toBe('create-brand-kit');
    expect([...CREATE_RAIL_ORDER]).not.toContain('create-brand-kit');
  });
});
