import { describe, expect, it } from 'vitest';

import {
  nextoreTierBaseUrl,
  resolveNextoreRunProvider,
} from '../src/nextore/models/resolve-run-provider.js';

const config = {
  baseUrl: 'https://nextore.example.test',
  oauthClientId: 'client-1',
  designerBaseUrl: 'https://designer.example.test',
  secretFile: '/run/secrets/designer_secret',
  trustProxy: null,
};

const session = { accessToken: 'nex-token' };

describe('nextoreTierBaseUrl', () => {
  it('appends the tier path without doubling the slash', () => {
    expect(nextoreTierBaseUrl('https://nextore.test', 'fast'))
      .toBe('https://nextore.test/api/designer/llm/fast/v1');
    expect(nextoreTierBaseUrl('https://nextore.test/', 'expert'))
      .toBe('https://nextore.test/api/designer/llm/expert/v1');
  });
});

describe('resolveNextoreRunProvider', () => {
  it('defaults to the expert tier', () => {
    const resolved = resolveNextoreRunProvider({ config, session, tier: undefined });
    expect(resolved).toMatchObject({ ok: true, tier: 'expert', model: 'expert' });
    expect(resolved.ok && resolved.byokProvider.baseUrl)
      .toBe('https://nextore.example.test/api/designer/llm/expert/v1');
  });

  it('routes the fast tier to its own endpoint', () => {
    const resolved = resolveNextoreRunProvider({ config, session, tier: 'fast' });
    expect(resolved).toMatchObject({ ok: true, tier: 'fast', model: 'fast' });
    expect(resolved.ok && resolved.byokProvider.baseUrl)
      .toBe('https://nextore.example.test/api/designer/llm/fast/v1');
  });

  it('uses the session token as the provider key and never a client value', () => {
    const resolved = resolveNextoreRunProvider({ config, session, tier: 'expert' });
    expect(resolved.ok && resolved.byokProvider).toEqual({
      protocol: 'openai',
      apiKey: 'nex-token',
      baseUrl: 'https://nextore.example.test/api/designer/llm/expert/v1',
    });
  });

  it('refuses a run without a session', () => {
    expect(resolveNextoreRunProvider({ config, session: null, tier: 'expert' }))
      .toMatchObject({ ok: false, status: 401, code: 'SESSION_REQUIRED' });
  });

  it('refuses a blank access token', () => {
    expect(resolveNextoreRunProvider({ config, session: { accessToken: '   ' }, tier: 'expert' }))
      .toMatchObject({ ok: false, status: 401, code: 'SESSION_REQUIRED' });
  });

  it('rejects an unknown tier instead of guessing', () => {
    expect(resolveNextoreRunProvider({ config, session, tier: 'turbo' }))
      .toMatchObject({ ok: false, status: 400, code: 'TIER_INVALID' });
  });

describe('P12 explicit modelKey', () => {
  it('routes a concrete platform model to its own module endpoint', () => {
    const resolved = resolveNextoreRunProvider({
      config,
      session,
      tier: 'expert',
      modelKey: 'model:42',
    });
    expect(resolved).toMatchObject({
      ok: true,
      model: 'model:42',
      modelKey: 'model:42',
    });
    expect(resolved.ok && resolved.byokProvider.baseUrl)
      .toBe('https://nextore.example.test/api/designer/llm/models/42/v1');
  });

  it('treats presets as aliases and rejects arbitrary keys', () => {
    expect(resolveNextoreRunProvider({ config, session, tier: 'expert', modelKey: 'fast' }))
      .toMatchObject({ ok: true, model: 'fast', tier: 'fast' });
    expect(resolveNextoreRunProvider({ config, session, tier: 'expert', modelKey: 'https://evil.test' }))
      .toMatchObject({ ok: false, status: 400, code: 'MODEL_KEY_INVALID' });
  });
});

describe('D40 small_model alias', () => {
  it('resolves small_model to the fast tier base URL', () => {
    const result = resolveNextoreRunProvider({
      config: { baseUrl: 'https://nextore.test/' },
      session: { accessToken: 'token' },
      tier: 'small_model',
    } as never);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tier).toBe('fast');
    expect(result.byokProvider.baseUrl).toBe('https://nextore.test/api/designer/llm/fast/v1');
  });

  it('keeps a real tier unchanged and rejects an unknown alias', () => {
    const expert = resolveNextoreRunProvider({
      config: { baseUrl: 'https://nextore.test' },
      session: { accessToken: 'token' },
      tier: 'expert',
    } as never);
    expect(expert.ok && expert.tier).toBe('expert');

    const bogus = resolveNextoreRunProvider({
      config: { baseUrl: 'https://nextore.test' },
      session: { accessToken: 'token' },
      tier: 'turbo',
    } as never);
    expect(bogus.ok).toBe(false);
  });
});
});
