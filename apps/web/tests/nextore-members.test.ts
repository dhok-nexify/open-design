import { describe, expect, it, vi } from 'vitest';

import {
  fetchCurrentMemberId,
  fetchNextoreMembers,
  memberDisplayName,
} from '../src/nextore-members';

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, json: async () => body } as unknown as Response;
}

describe('nextore-members', () => {
  it('reads the current member id', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ memberId: 7 }));
    await expect(fetchCurrentMemberId(fetchImpl as never)).resolves.toBe(7);
    expect(fetchImpl).toHaveBeenCalledWith('/api/nextore/session', expect.anything());
  });

  it('returns no members when the directory call fails', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, false));
    await expect(fetchNextoreMembers([31], fetchImpl as never)).resolves.toEqual([]);
  });

  it('looks up ids once and caches them', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      members: [
        { id: 11, fullName: 'Ada Lovelace', login: 'ada' },
        { id: 12, fullName: '', login: 'grace' },
      ],
    }));
    const first = await fetchNextoreMembers([11, 12, 11], fetchImpl as never);
    expect(first).toHaveLength(2);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain('ids=11,12');

    const second = await fetchNextoreMembers([11], fetchImpl as never);
    expect(second[0]?.fullName).toBe('Ada Lovelace');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('returns nothing for an empty or invalid id list', async () => {
    const fetchImpl = vi.fn();
    await expect(fetchNextoreMembers([], fetchImpl as never)).resolves.toEqual([]);
    await expect(fetchNextoreMembers([0, -1], fetchImpl as never)).resolves.toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('prefers full name, then login, then a legible fallback', () => {
    expect(memberDisplayName({ id: 1, fullName: 'Ada', login: 'ada' }, 1)).toBe('Ada');
    expect(memberDisplayName({ id: 2, login: 'grace' }, 2)).toBe('grace');
    expect(memberDisplayName(null, 3)).toBe('Member 3');
  });
});
