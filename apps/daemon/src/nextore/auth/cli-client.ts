import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';

/**
 * NXD-P10 CLI authorization helper.
 *
 * The browser proves the human; the loopback listener + PKCE proves the CLI
 * channel. The token file is owner-only (chmod 0600, and an explicit ACL on
 * Windows where chmod is a no-op).
 */

export interface StoredCliToken {
  token: string;
  tokenId: string;
  memberId: number;
  scopes: string[];
  expiresAt: number;
  daemonUrl: string;
}

export function cliTokenPath(): string {
  return join(homedir(), '.open-design', 'nextore-token.json');
}

export function createPkcePair(): { verifier: string; challenge: string; state: string } {
  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier, 'utf8').digest('base64url');
  const state = randomBytes(16).toString('base64url');
  return { verifier, challenge, state };
}

/** Restrict the token file to the current principal only. */
export function restrictTokenFile(path: string): void {
  if (process.platform === 'win32') {
    const user = process.env.USERNAME;
    if (!user) return;
    execFile('icacls', [path, '/inheritance:r', '/grant:r', user + ':F'], () => {});
    return;
  }
  chmodSync(path, 0o600);
}

export function writeCliToken(token: StoredCliToken): string {
  const path = cliTokenPath();
  mkdirSync(join(homedir(), '.open-design'), { recursive: true });
  writeFileSync(path, JSON.stringify(token, null, 2), { encoding: 'utf8', mode: 0o600 });
  restrictTokenFile(path);
  return path;
}

export function readCliToken(): StoredCliToken | null {
  const path = cliTokenPath();
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as StoredCliToken;
    return typeof parsed?.token === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

export function clearCliToken(): boolean {
  const path = cliTokenPath();
  if (!existsSync(path)) return false;
  rmSync(path, { force: true });
  return true;
}

export interface LoginResult {
  token: StoredCliToken;
  url: string;
}

/**
 * Run the loopback login. Resolves once the browser redirects back with a code,
 * then exchanges the code for a token.
 */
export async function loginViaBrowser(options: {
  daemonUrl: string;
  openBrowser?: (url: string) => void;
  timeoutMs?: number;
}): Promise<StoredCliToken> {
  const { verifier, challenge, state } = createPkcePair();
  const daemon = options.daemonUrl.replace(/\/+$/, '');

  const code = await new Promise<{ code: string; state: string }>((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (url.pathname !== '/callback') {
        res.statusCode = 404;
        res.end();
        return;
      }
      const receivedCode = url.searchParams.get('code') ?? '';
      const receivedState = url.searchParams.get('state') ?? '';
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end('<!doctype html><title>Signed in</title><p>You can return to the terminal.</p>');
      server.close();
      resolve({ code: receivedCode, state: receivedState });
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('loopback listener failed'));
        return;
      }
      const redirect = 'http://127.0.0.1:' + address.port + '/callback';
      const authorize = daemon + '/auth/cli?state=' + encodeURIComponent(state)
        + '&challenge=' + encodeURIComponent(challenge)
        + '&redirect=' + encodeURIComponent(redirect);
      options.openBrowser?.(authorize);
      console.log('Open this URL to authorize the CLI:\n' + authorize);
    });
    const timer = setTimeout(() => {
      server.close();
      reject(new Error('login timed out'));
    }, options.timeoutMs ?? 180_000);
    timer.unref?.();
  });

  if (code.state !== state) throw new Error('state mismatch');
  const response = await fetch(daemon + '/api/auth/cli/token', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: code.code, verifier, state }),
  });
  if (!response.ok) throw new Error('token exchange failed: ' + response.status);
  const payload = await response.json() as {
    token: string; tokenId: string; memberId: number; scopes: string[]; expiresAt: number;
  };
  const stored: StoredCliToken = { ...payload, daemonUrl: daemon };
  writeCliToken(stored);
  return stored;
}
