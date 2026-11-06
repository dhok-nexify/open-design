import { describe, expect, it, vi } from 'vitest';

import {
  fetchNextoreProjectListing,
  remoteOnlyProjects,
} from '../src/nextore-projects';

const listing = {
  projects: [
    { nextoreProjectId: '1', designerProjectId: 'local-a', name: 'Landing page', hasLocalContent: true },
    { nextoreProjectId: '2', designerProjectId: 'local-b', name: 'Deck draft', hasLocalContent: false },
    { nextoreProjectId: '3', designerProjectId: 'local-c', name: '', hasLocalContent: false },
  ],
  remoteWithoutLocal: ['local-b'],
  localWithoutRemote: [],
};

describe('remoteOnlyProjects', () => {
  it('keeps only projects without local content and with a name', () => {
    expect(remoteOnlyProjects(listing).map((p) => p.designerProjectId)).toEqual(['local-b']);
  });

  it('tolerates a missing listing', () => {
    expect(remoteOnlyProjects(null)).toEqual([]);
  });
});

describe('fetchNextoreProjectListing', () => {
  it('normalises the payload', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ projects: [{ nextoreProjectId: '1' }] }),
    } as unknown as Response);
    const result = await fetchNextoreProjectListing(fetchImpl as never);
    expect(result?.projects).toHaveLength(1);
    expect(result?.remoteWithoutLocal).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledWith('/api/nextore/projects', expect.anything());
  });

  it('returns null on failure', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) } as unknown as Response);
    await expect(fetchNextoreProjectListing(fetchImpl as never)).resolves.toBeNull();
  });
});
