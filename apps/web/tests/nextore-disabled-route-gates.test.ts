// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The NexTore edition makes whole capability families unrouteable on the
 * daemon (see `createEditionRouteKillSwitch` in `apps/daemon/src/edition`),
 * so a shell probe for one of them is a guaranteed 404 — and a console error
 * the operator reads as a broken product. These cases pin both halves of the
 * contract: the edition answers locally, upstream keeps asking.
 */

const EDITION_ENV = 'NEXT_PUBLIC_OD_EDITION';

const ANALYTICS_CONTEXT = {
  anonymousId: 'anonymous-id',
  sessionId: 'session-id',
  clientType: 'web',
  locale: 'en',
  appVersion: '0.0.0-test',
} as const;

function stubFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response('{"loggedIn":false}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })),
  );
}

describe('NexTore edition — disabled routes are answered locally', () => {
  beforeEach(() => {
    vi.stubEnv(EDITION_ENV, 'nextore');
    vi.resetModules();
    stubFetch();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('answers every AMR read without a request', async () => {
    const { readVelaLoginStatus, fetchVelaLoginStatus, fetchAmrModels, fetchAmrWalletSnapshot } =
      await import('../src/providers/daemon');

    await expect(readVelaLoginStatus()).resolves.toEqual({
      ok: false,
      httpStatus: 404,
      body: null,
    });
    await expect(readVelaLoginStatus({ refresh: true })).resolves.toEqual({
      ok: false,
      httpStatus: 404,
      body: null,
    });
    await expect(fetchVelaLoginStatus()).resolves.toBeNull();
    await expect(fetchAmrModels()).resolves.toBeNull();
    await expect(fetchAmrWalletSnapshot()).resolves.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('treats the message center as signed out and stops polling', async () => {
    const { isAmrLoggedIn, pullMessageCenter, markAccountMessageRead } = await import(
      '../src/message-center-client'
    );

    await expect(isAmrLoggedIn()).resolves.toBe(false);
    await expect(pullMessageCenter({ locale: 'en', loggedIn: false })).resolves.toEqual([]);
    await expect(pullMessageCenter({ locale: 'en', loggedIn: true })).resolves.toEqual([]);
    await expect(markAccountMessageRead('message-id')).resolves.toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns empty connector surfaces', async () => {
    const registry = await import('../src/providers/registry');
    const { fetchComposioConfigFromDaemon } = await import('../src/state/config');

    await expect(registry.fetchConnectors()).resolves.toEqual([]);
    await expect(registry.fetchConnectorStatuses()).resolves.toEqual({});
    await expect(registry.fetchConnectorDiscovery({ refresh: true })).resolves.toEqual([]);
    await expect(fetchComposioConfigFromDaemon()).resolves.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('probes /api/agents so the composer knows its runtime is installed', async () => {
    const { fetchAgents, fetchAgentsStream } = await import('../src/providers/registry');

    // Round-5 NEW-04: gating this probe on the hidden agent-picker feature left
    // the agent map empty and the project composer silently refused every send.
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response('{"agents":[]}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ));

    await expect(fetchAgents()).resolves.toEqual([]);
    expect(fetch).toHaveBeenCalledWith('/api/agents', { cache: 'no-store' });

    const streamFetch = vi.fn(async () =>
      new Response('event: done\ndata: {}\n\n', {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }),
    );
    vi.stubGlobal('fetch', streamFetch);

    await expect(fetchAgentsStream({ onAgent: () => {} })).resolves.toEqual([]);
    expect(streamFetch).toHaveBeenCalledWith(
      '/api/agents?stream=1',
      expect.objectContaining({ cache: 'no-store' }),
    );
  });

  it('falls back to the static media registry', async () => {
    const { fetchAIHubMixModels } = await import('../src/media/aihubmix-image-models');
    const { fetchElevenLabsVoiceOptions } = await import('../src/providers/elevenlabs-voices');

    await expect(fetchAIHubMixModels('image_generation')).resolves.toEqual([]);
    await expect(fetchElevenLabsVoiceOptions()).resolves.toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('skips the analytics config read', async () => {
    const { bootstrapExceptionTracking, getAnalyticsClient } = await import(
      '../src/analytics/client'
    );

    await expect(getAnalyticsClient(ANALYTICS_CONTEXT)).resolves.toBeNull();
    await expect(bootstrapExceptionTracking(ANALYTICS_CONTEXT)).resolves.toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('upstream — the gates stay edition-scoped', () => {
  beforeEach(() => {
    vi.stubEnv(EDITION_ENV, 'upstream');
    vi.resetModules();
    stubFetch();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('still reads the AMR status projection', async () => {
    const { readVelaLoginStatus } = await import('../src/providers/daemon');

    await readVelaLoginStatus();
    expect(fetch).toHaveBeenCalledWith('/api/integrations/vela/status', { cache: 'no-store' });
  });

  it('still lists connectors', async () => {
    const { fetchConnectors } = await import('../src/providers/registry');

    await fetchConnectors();
    expect(fetch).toHaveBeenCalledWith('/api/connectors');
  });

  it('still asks for the analytics config', async () => {
    const { bootstrapExceptionTracking } = await import('../src/analytics/client');

    await bootstrapExceptionTracking(ANALYTICS_CONTEXT);
    expect(fetch).toHaveBeenCalledWith('/api/analytics/config');
  });
});
