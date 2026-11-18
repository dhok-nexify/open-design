import { describe, expect, it, vi } from 'vitest';

import type { NextoreConfig } from '../src/nextore/config.js';
import type {
  NextoreSession,
  NextoreSessionStore,
  NewNextoreSession,
  TokenUpdate,
  NextoreSessionMember,
} from '../src/nextore/auth/session-store.js';
import type { TokenSet } from '../src/nextore/auth/oauth.js';
import { resolveMemberAccessToken } from '../src/nextore/artifacts/session-access.js';

const config = {
  baseUrl: 'http://nextore.test',
  oauthClientId: 'client',
  designerBaseUrl: 'http://designer.test',
  secretFile: '/run/secrets/designer',
  trustProxy: null,
} satisfies NextoreConfig;

const member: NextoreSessionMember = {
  id: 7,
  login: 'alice',
  fullName: 'Alice',
  email: 'alice@example.test',
  language: 'en',
  profileObjectId: 1,
};

function session(overrides: Partial<NextoreSession> = {}): NextoreSession {
  return {
    sid: 'sid-1',
    memberId: 7,
    member,
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
    tokenExpiresAt: 2_000_000,
    createdAt: 1_000,
    lastSeenAt: 1_000,
    lastValidatedAt: 1_000,
    ...overrides,
  };
}

class FakeSessionStore implements NextoreSessionStore {
  rows = new Map<string, NextoreSession>();

  create(_session: NewNextoreSession): NextoreSession {
    throw new Error('not implemented');
  }

  find(sid: string): NextoreSession | null {
    return this.rows.get(sid) ?? null;
  }

  touch(sid: string, seenAt: number): void {
    const row = this.rows.get(sid);
    if (row) this.rows.set(sid, { ...row, lastSeenAt: seenAt });
  }

  updateTokens(sid: string, update: TokenUpdate): void {
    const row = this.rows.get(sid);
    if (!row) return;
    this.rows.set(sid, {
      ...row,
      accessToken: update.accessToken,
      refreshToken: update.refreshToken,
      tokenExpiresAt: update.tokenExpiresAt,
      lastValidatedAt: update.validatedAt,
    });
  }

  recordValidation(sid: string, validatedAt: number, nextMember: NextoreSessionMember): void {
    const row = this.rows.get(sid);
    if (row) this.rows.set(sid, { ...row, member: nextMember, lastValidatedAt: validatedAt });
  }

  remove(sid: string): void {
    this.rows.delete(sid);
  }

  pruneExpired(_before: number): number {
    return 0;
  }

  listByMember(memberId: number): NextoreSession[] {
    return [...this.rows.values()].filter((row) => row.memberId === memberId);
  }
}

function storeWith(...rows: NextoreSession[]): FakeSessionStore {
  const store = new FakeSessionStore();
  for (const row of rows) store.rows.set(row.sid, row);
  return store;
}

const refreshed: TokenSet = {
  accessToken: 'access-2',
  refreshToken: 'refresh-2',
  expiresAt: 3_000_000,
  scope: 'designer',
};

describe('resolveMemberAccessToken', () => {
  it('returns a still-valid token without refreshing', async () => {
    const store = storeWith(session({ tokenExpiresAt: 2_000_000 }));
    const refresh = vi.fn(async () => refreshed);

    await expect(resolveMemberAccessToken(7, {
      store,
      config,
      now: () => 1_000,
      refresh,
    })).resolves.toBe('access-1');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('single-flights a near-expiry refresh', async () => {
    const store = storeWith(session({ tokenExpiresAt: 31_000 }));
    const refresh = vi.fn(async () => refreshed);

    const [first, second] = await Promise.all([
      resolveMemberAccessToken(7, { store, config, now: () => 1_000, refresh }),
      resolveMemberAccessToken(7, { store, config, now: () => 1_000, refresh }),
    ]);

    expect(first).toBe('access-2');
    expect(second).toBe('access-2');
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(store.find('sid-1')).toMatchObject({
      accessToken: 'access-2',
      refreshToken: 'refresh-2',
      tokenExpiresAt: 3_000_000,
    });
  });

  it('removes a session without a refresh token', async () => {
    const store = storeWith(session({ tokenExpiresAt: 31_000, refreshToken: null }));

    await expect(resolveMemberAccessToken(7, {
      store,
      config,
      now: () => 1_000,
    })).resolves.toBeNull();
    expect(store.find('sid-1')).toBeNull();
  });

  it('removes a session when refresh fails permanently', async () => {
    const store = storeWith(session({ tokenExpiresAt: 31_000 }));

    await expect(resolveMemberAccessToken(7, {
      store,
      config,
      now: () => 1_000,
      refresh: async () => {
        throw new Error('invalid_grant');
      },
      isPermanentFailure: () => true,
    })).resolves.toBeNull();
    expect(store.find('sid-1')).toBeNull();
  });

  it('skips a revoked session', async () => {
    const store = storeWith(session());

    await expect(resolveMemberAccessToken(7, {
      store,
      config,
      now: () => 1_000,
      isRevoked: () => true,
    })).resolves.toBeNull();
  });

  it('falls through to the next session when one refresh is unavailable', async () => {
    const store = storeWith(
      session({ sid: 'expired', tokenExpiresAt: 31_000, lastSeenAt: 2_000 }),
      session({ sid: 'healthy', tokenExpiresAt: 2_000_000, accessToken: 'access-healthy', lastSeenAt: 1_000 }),
    );

    await expect(resolveMemberAccessToken(7, {
      store,
      config,
      now: () => 1_000,
      refresh: async () => {
        throw new Error('temporary outage');
      },
      isPermanentFailure: () => false,
    })).resolves.toBe('access-healthy');
  });
});
