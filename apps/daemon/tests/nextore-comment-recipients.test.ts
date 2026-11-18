import { describe, expect, it, vi } from 'vitest';

import {
  createRecipientCache,
  resolveProjectManageRecipients,
} from '../src/nextore/comment-recipients.js';

function client(payload: unknown) {
  return { projectPermissions: vi.fn(async () => payload) };
}

const base = {
  accessToken: 'token',
  nextoreProjectId: 'nxt-1',
  ownerMemberId: 7,
};

describe('P05 CanManage recipients', () => {
  it('collects members whose permission row grants manage', async () => {
    const result = await resolveProjectManageRecipients({
      ...base,
      client: client({ members: [
        { memberId: 8, manage: true },
        { memberId: 9, canManage: true },
        { memberId: 10, manage: false },
      ] }),
    });

    expect(result.degraded).toBe(false);
    expect(result.memberIds.sort()).toEqual([7, 8, 9]);
  });

  it('excludes members without manage even when they can read and edit', async () => {
    const result = await resolveProjectManageRecipients({
      ...base,
      client: client({ members: [{ memberId: 8, canRead: true, canEdit: true }] }),
    });

    expect(result.memberIds).toEqual([7]);
  });

  it('always includes the owner', async () => {
    const result = await resolveProjectManageRecipients({
      ...base,
      client: client({ members: [] }),
    });

    expect(result.memberIds).toContain(7);
  });

  it('degrades to owner only when the module fails', async () => {
    const failing = { projectPermissions: vi.fn(async () => { throw new Error('500'); }) };

    const result = await resolveProjectManageRecipients({ ...base, client: failing });

    expect(result).toEqual({ memberIds: [7], degraded: true });
  });

  it('does not hit the network twice inside the cache window', async () => {
    let clock = 1_000;
    const cache = createRecipientCache(60_000, () => clock);
    const stub = client({ members: [{ memberId: 8, manage: true }] });

    await resolveProjectManageRecipients({ ...base, client: stub, cache, now: () => clock });
    clock += 30_000;
    const second = await resolveProjectManageRecipients({ ...base, client: stub, cache, now: () => clock });

    expect(second.memberIds.sort()).toEqual([7, 8]);
    expect(stub.projectPermissions).toHaveBeenCalledTimes(1);
  });
});
