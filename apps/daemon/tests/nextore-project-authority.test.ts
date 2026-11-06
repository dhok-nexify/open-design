import { describe, expect, it, vi } from 'vitest';

import {
  createProjectAccessCache,
  type NextoreProjectAccess,
} from '../src/nextore/acl/access-cache.js';
import { createNextoreProjectAuthorizer } from '../src/nextore/acl/authorize-project.js';
import type { AuthorizeProjectRequest } from '../src/collab/project-request-authority.js';

const FULL: NextoreProjectAccess = {
  exists: true,
  canRead: true,
  canEdit: true,
  canDelete: true,
  canManage: true,
  canDownload: true,
};

const READ_ONLY: NextoreProjectAccess = {
  exists: true,
  canRead: true,
  canEdit: false,
  canDelete: false,
  canManage: false,
  canDownload: true,
};

describe('createProjectAccessCache', () => {
  it('serves a value inside the TTL and reloads after it', async () => {
    let now = 1_000;
    const load = vi.fn().mockResolvedValue(FULL);
    const cache = createProjectAccessCache({ ttlMs: 100, now: () => now });

    await cache.read('1:2', load);
    await cache.read('1:2', load);
    expect(load).toHaveBeenCalledTimes(1);

    now += 101;
    await cache.read('1:2', load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('dedupes concurrent loads for one key', async () => {
    let release: (value: NextoreProjectAccess) => void = () => {};
    const load = vi.fn(() => new Promise<NextoreProjectAccess>((resolve) => {
      release = resolve;
    }));
    const cache = createProjectAccessCache();

    const first = cache.read('1:2', load);
    const second = cache.read('1:2', load);
    release(FULL);
    await expect(first).resolves.toEqual(FULL);
    await expect(second).resolves.toEqual(FULL);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('invalidates one member without touching the others', async () => {
    const cache = createProjectAccessCache();
    const load = vi.fn().mockResolvedValue(FULL);
    await cache.read('1:2', load);
    await cache.read('2:2', load);
    cache.invalidatePrefix('1:');
    expect(cache.size()).toBe(1);
  });
});

describe('createNextoreProjectAuthorizer', () => {
  // Express handlers receive a Response; the authorizer only reads res.locals.
  const req = {} as never;
  const res = {} as unknown as Parameters<AuthorizeProjectRequest>[1];
const localAllow: AuthorizeProjectRequest = vi.fn(async () => true);
  const localDeny: AuthorizeProjectRequest = vi.fn(async () => false);

  function authorizer(overrides: Partial<Parameters<typeof createNextoreProjectAuthorizer>[1]> = {}) {
    const deny = vi.fn();
    const load = vi.fn().mockResolvedValue(FULL);
    const authorizer = createNextoreProjectAuthorizer(localAllow, {
      edition: 'nextore',
      cache: createProjectAccessCache(),
      load,
      readSession: () => ({ accessToken: 'token', memberId: 7 }),
      readProjectMapping: () => '42',
      deny,
      ...overrides,
    });
    return { authorizer, deny, load };
  }

  it('never consults NexTore upstream', async () => {
    const { authorizer: run, load } = authorizer({ edition: 'upstream' });
    await expect(run(req, res, 'local-1', { mode: 'read' })).resolves.toBe(true);
    expect(load).not.toHaveBeenCalled();
  });

  it('keeps an unmapped local project working', async () => {
    const { authorizer: run, load } = authorizer({ readProjectMapping: () => null });
    await expect(run(req, res, 'local-1', { mode: 'read' })).resolves.toBe(true);
    expect(load).not.toHaveBeenCalled();
  });

  it('stops at the local gate without calling the module', async () => {
    const deny = vi.fn();
    const load = vi.fn();
    const run = createNextoreProjectAuthorizer(localDeny, {
      edition: 'nextore',
      cache: createProjectAccessCache(),
      load,
      readSession: () => ({ accessToken: 'token', memberId: 7 }),
      readProjectMapping: () => '42',
      deny,
    });
    await expect(run(req, res, 'local-1', { mode: 'read' })).resolves.toBe(false);
    expect(load).not.toHaveBeenCalled();
    expect(deny).not.toHaveBeenCalled();
  });

  it('allows a mapped project with the required right', async () => {
    const { authorizer: run } = authorizer();
    await expect(run(req, res, 'local-1', { mode: 'read' })).resolves.toBe(true);
    await expect(run(req, res, 'local-1', { mode: 'write', capability: 'delete' })).resolves.toBe(true);
  });

  it('denies a mapped project without the required right', async () => {
    const { authorizer: run, deny } = authorizer({ load: vi.fn().mockResolvedValue(READ_ONLY) });
    await expect(run(req, res, 'local-1', { mode: 'write', capability: 'rename' })).resolves.toBe(false);
    expect(deny).toHaveBeenCalledWith(res, 403, 'PROJECT_FORBIDDEN', expect.any(String));
  });

  it('reports a missing NexTore project as 404', async () => {
    const { authorizer: run, deny } = authorizer({
      load: vi.fn().mockResolvedValue({ ...READ_ONLY, exists: false }),
    });
    await expect(run(req, res, 'local-1', { mode: 'read' })).resolves.toBe(false);
    expect(deny).toHaveBeenCalledWith(res, 404, 'PROJECT_NOT_FOUND', expect.any(String));
  });

  it('requires a session for a mapped project', async () => {
    const { authorizer: run, deny } = authorizer({ readSession: () => null });
    await expect(run(req, res, 'local-1', { mode: 'read' })).resolves.toBe(false);
    expect(deny).toHaveBeenCalledWith(res, 401, 'SESSION_REQUIRED', expect.any(String));
  });

  it('fails closed when the module cannot answer', async () => {
    const { authorizer: run, deny } = authorizer({
      load: vi.fn().mockRejectedValue(new Error('down')),
    });
    await expect(run(req, res, 'local-1', { mode: 'read' })).resolves.toBe(false);
    expect(deny).toHaveBeenCalledWith(res, 503, 'NEXTORE_UNAVAILABLE', expect.any(String));
  });
});
