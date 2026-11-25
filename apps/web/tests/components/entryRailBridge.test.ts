// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import { RAIL_OPEN_STORAGE_KEY, readStoredRailOpen } from '../../src/components/entryRailBridge';

afterEach(() => {
  window.localStorage.clear();
});

describe('readStoredRailOpen', () => {
  it('reports "never chosen" as null, not as collapsed', () => {
    // The distinction is what lets the entry shell open the rail once for an
    // account that cannot create projects, without overriding a real choice.
    expect(readStoredRailOpen()).toBeNull();
  });

  it('reads an explicit collapse', () => {
    window.localStorage.setItem(RAIL_OPEN_STORAGE_KEY, 'false');
    expect(readStoredRailOpen()).toBe(false);
  });

  it('reads an explicit expand', () => {
    window.localStorage.setItem(RAIL_OPEN_STORAGE_KEY, 'true');
    expect(readStoredRailOpen()).toBe(true);
  });

  it('treats unreadable storage as "never chosen"', () => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = () => {
      throw new Error('denied');
    };
    try {
      expect(readStoredRailOpen()).toBeNull();
    } finally {
      Storage.prototype.getItem = original;
    }
  });
});
