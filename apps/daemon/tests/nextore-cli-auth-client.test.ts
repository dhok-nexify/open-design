import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  clearCliToken,
  cliTokenPath,
  createPkcePair,
  readCliToken,
  writeCliToken,
} from '../src/nextore/auth/cli-client.js';
import { codeChallengeS256 } from '../src/nextore/auth/cli-auth.js';

let home: string;
const originalHome = process.env.HOME;
const originalProfile = process.env.USERPROFILE;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'od-cli-auth-'));
  process.env.HOME = home;
  process.env.USERPROFILE = home;
});

afterEach(async () => {
  process.env.HOME = originalHome;
  process.env.USERPROFILE = originalProfile;
  await rm(home, { recursive: true, force: true });
});

const stored = {
  token: 'odt_test',
  tokenId: 'id-1',
  memberId: 7,
  scopes: ['project:read', 'run:create'],
  expiresAt: 2_000_000,
  daemonUrl: 'http://127.0.0.1:7456',
};

describe('od auth token file', () => {
  it('writes, reads and clears the token', () => {
    expect(readCliToken()).toBeNull();

    const path = writeCliToken(stored);
    expect(path).toBe(cliTokenPath());
    expect(readCliToken()).toMatchObject({ memberId: 7, token: 'odt_test' });

    expect(clearCliToken()).toBe(true);
    expect(readCliToken()).toBeNull();
    expect(clearCliToken()).toBe(false);
  });

  it('is owner-readable only on POSIX', async () => {
    const path = writeCliToken(stored);
    if (process.platform !== 'win32') {
      const mode = (await stat(path)).mode & 0o777;
      expect(mode).toBe(0o600);
    }
    // Windows relies on icacls; the file must still exist and be parseable.
    expect(JSON.parse(await readFile(path, 'utf8')).token).toBe('odt_test');
  });
});

describe('PKCE pair', () => {
  it('produces a verifier whose S256 challenge matches', () => {
    const pair = createPkcePair();
    expect(pair.verifier.length).toBeGreaterThanOrEqual(43);
    expect(pair.challenge).toBe(codeChallengeS256(pair.verifier));
    expect(pair.state.length).toBeGreaterThanOrEqual(16);
  });

  it('never repeats a verifier or state', () => {
    const a = createPkcePair();
    const b = createPkcePair();
    expect(a.verifier).not.toBe(b.verifier);
    expect(a.state).not.toBe(b.state);
  });
});
