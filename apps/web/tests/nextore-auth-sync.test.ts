// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class FakeBroadcastChannel {
  static all: FakeBroadcastChannel[] = [];
  static reset(): void {
    FakeBroadcastChannel.all = [];
  }
  static channels(name: string): FakeBroadcastChannel[] {
    return FakeBroadcastChannel.all.filter((channel) => channel.name === name);
  }

  readonly posted: unknown[] = [];
  private readonly listeners = new Set<(event: MessageEvent) => void>();

  constructor(readonly name: string) {
    FakeBroadcastChannel.all.push(this);
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void): void {
    if (type === 'message') this.listeners.add(listener);
  }

  removeEventListener(type: string, listener: (event: MessageEvent) => void): void {
    if (type === 'message') this.listeners.delete(listener);
  }

  postMessage(data: unknown): void {
    this.posted.push(data);
    for (const channel of FakeBroadcastChannel.channels(this.name)) {
      if (channel === this) continue;
      for (const listener of channel.listeners) {
        listener(new MessageEvent('message', { data }));
      }
    }
  }

  close(): void {}
}

let current: {
  signOut: typeof import('../src/nextore/sign-out');
  guard: typeof import('../src/nextore/session-guard');
} | null = null;

async function loadEditionModules() {
  vi.stubEnv('NEXT_PUBLIC_OD_EDITION', 'nextore');
  vi.resetModules();
  const signOut = await import('../src/nextore/sign-out');
  const guard = await import('../src/nextore/session-guard');
  current = { signOut, guard };
  return current;
}

beforeEach(() => {
  FakeBroadcastChannel.reset();
  vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel);
  window.sessionStorage.clear();
});

afterEach(() => {
  current?.signOut.resetAuthSyncForTests();
  current?.guard.resetNextoreSessionRedirectForTests();
  current = null;
  FakeBroadcastChannel.reset();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  delete (document as unknown as Record<string, unknown>).visibilityState;
  window.sessionStorage.clear();
});

describe('cross-tab sign-out', () => {
  it('broadcasts the signed-out event after the daemon ends the session', async () => {
    const { signOut } = await loadEditionModules();
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));

    expect(await signOut.signOutOfDesigner(fetchMock as unknown as typeof fetch)).toBe(true);
    expect(signOut.isSignedOut()).toBe(true);
    const channel = FakeBroadcastChannel.channels(signOut.AUTH_SYNC_CHANNEL_NAME)[0];
    expect(channel?.posted).toEqual([expect.objectContaining({ type: 'signed-out' })]);
  });

  it('marks another tab signed out and sends it to the signed-out page', async () => {
    const { signOut } = await loadEditionModules();
    const navigate = vi.fn();
    const cleanup = signOut.installAuthSync(navigate);
    const sender = new FakeBroadcastChannel(signOut.AUTH_SYNC_CHANNEL_NAME);

    sender.postMessage({ type: 'signed-out', at: 123 });

    expect(signOut.isSignedOut()).toBe(true);
    expect(navigate).toHaveBeenCalledWith('/');
    cleanup();
  });
});

describe('visibility session validation', () => {
  it('navigates to the OAuth entry when /auth/me reports 401', async () => {
    const { signOut, guard } = await loadEditionModules();
    const navigate = vi.fn();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ signedIn: false }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    }));
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    guard.installNextoreSessionRedirect({
      fetchImpl: fetchMock as unknown as typeof fetch,
      navigate,
      now: () => 1_000,
    });

    expect((window as unknown as { __nxdSessionRedirect?: boolean }).__nxdSessionRedirect).toBe(true);
    expect(document.visibilityState).toBe('visible');
    expect(signOut.isSignedOut()).toBe(false);
    expect(window.sessionStorage.getItem('nxd:session-redirect')).toBeNull();
    document.dispatchEvent(new Event('visibilitychange'));

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/auth/me',
      expect.objectContaining({ cache: 'no-store' }),
    ));
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('/auth/start?return=%2F'));
  });

  it('does not navigate when /auth/me answers 200', async () => {
    const { guard } = await loadEditionModules();
    const navigate = vi.fn();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      signedIn: true,
      reauthDue: false,
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    guard.installNextoreSessionRedirect({
      fetchImpl: fetchMock as unknown as typeof fetch,
      navigate,
      now: () => 2_000,
    });

    document.dispatchEvent(new Event('visibilitychange'));

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(navigate).not.toHaveBeenCalled();
  });

  it('does not check a tab that already signed out explicitly', async () => {
    const { signOut, guard } = await loadEditionModules();
    signOut.markSignedOut();
    const navigate = vi.fn();
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    guard.installNextoreSessionRedirect({
      fetchImpl: fetchMock as unknown as typeof fetch,
      navigate,
      now: () => 3_000,
    });

    document.dispatchEvent(new Event('visibilitychange'));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
});
