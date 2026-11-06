import { describe, expect, it, vi } from 'vitest';

import {
  LOCAL_PROJECT_ACCESS,
  fetchNextoreProjectAccess,
} from '../src/nextore/access';

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: async () => body,
  } as unknown as Response;
}

describe('fetchNextoreProjectAccess', () => {
  it('requests the project access endpoint', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      mapped: true,
      exists: true,
      canRead: true,
      canEdit: false,
      canDelete: false,
      canManage: false,
      canDownload: true,
    }));

    const access = await fetchNextoreProjectAccess('p 1', { fetchImpl } as never);

    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/projects/p%201/nextore-access',
      expect.objectContaining({ headers: { accept: 'application/json' } }),
    );
    expect(access).toMatchObject({ mapped: true, canEdit: false, canRead: true });
  });

  it('keeps the local default when the request fails', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('offline'));
    expect(await fetchNextoreProjectAccess('p1', { fetchImpl } as never)).toBeNull();
    expect(LOCAL_PROJECT_ACCESS.canEdit).toBe(true);
  });

  it('returns null on a non-2xx answer', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, false));
    expect(await fetchNextoreProjectAccess('p1', { fetchImpl } as never)).toBeNull();
  });

  it('defaults missing flags to true so a partial payload cannot lock a project', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ mapped: true, canRead: true }));
    const access = await fetchNextoreProjectAccess('p1', { fetchImpl } as never);
    expect(access).toMatchObject({
      mapped: true,
      canEdit: true,
      canDelete: true,
      canManage: true,
    });
  });
});
