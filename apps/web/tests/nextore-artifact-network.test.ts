// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import {
  ARTIFACT_NETWORK_NONE,
  artifactNetworkRequestAllowed,
  buildArtifactNetworkGuardScript,
  resolveArtifactNetworkRules,
} from '../src/runtime/artifact-network';
import { injectPreviewConnectCsp } from '../src/runtime/srcdoc';

/**
 * NXD-D25 follow-up: an artifact may keep its default `connect-src 'none'`, or a
 * project may opt into same-origin GET/HEAD reads under explicit path prefixes.
 * The policy is enforced in two layers — a relaxed CSP meta plus an injected
 * guard — so both halves are covered here.
 */

const ORIGIN = 'http://localhost:3000';

describe('resolveArtifactNetworkRules', () => {
  it('keeps the strict policy for absent or unknown metadata', () => {
    expect(resolveArtifactNetworkRules(undefined)).toEqual(ARTIFACT_NETWORK_NONE);
    expect(resolveArtifactNetworkRules({})).toEqual(ARTIFACT_NETWORK_NONE);
    expect(resolveArtifactNetworkRules({ artifactNetwork: 'open' })).toEqual(ARTIFACT_NETWORK_NONE);
    expect(resolveArtifactNetworkRules('same-origin-readonly')).toEqual(ARTIFACT_NETWORK_NONE);
  });

  it('stays strict when the opt-in lists no usable path', () => {
    expect(resolveArtifactNetworkRules({
      artifactNetwork: 'same-origin-readonly',
      artifactNetworkPaths: [],
    })).toEqual(ARTIFACT_NETWORK_NONE);
    expect(resolveArtifactNetworkRules({
      artifactNetwork: 'same-origin-readonly',
      artifactNetworkPaths: '/artifacts/p1',
    })).toEqual(ARTIFACT_NETWORK_NONE);
  });

  it('accepts rooted prefixes and normalizes their trailing slash', () => {
    expect(resolveArtifactNetworkRules({
      artifactNetwork: 'same-origin-readonly',
      artifactNetworkPaths: ['/artifacts/p1', '/artifacts/p1/', '/frames/p1/'],
    })).toEqual({
      policy: 'same-origin-readonly',
      paths: ['/artifacts/p1/', '/frames/p1/'],
    });
  });

  it('rejects traversal, absolute URLs, the bare root and markup', () => {
    const rules = resolveArtifactNetworkRules({
      artifactNetwork: 'same-origin-readonly',
      artifactNetworkPaths: ['/', '//evil.example/x', 'https://evil.example/', '/a/../b', '/a?x=1', '/a/<b>', '/a b'],
    });
    expect(rules).toEqual(ARTIFACT_NETWORK_NONE);
  });
});

describe('artifactNetworkRequestAllowed', () => {
  const paths = ['/artifacts/p1/'];
  const allowed = (url: string, method = 'GET') =>
    artifactNetworkRequestAllowed({ paths, base: ORIGIN + '/', url, method });

  it('allows a same-origin read under the prefix', () => {
    expect(allowed('/artifacts/p1/data.json')).toBe(true);
    expect(allowed(ORIGIN + '/artifacts/p1/data.json', 'HEAD')).toBe(true);
    expect(allowed('/artifacts/p1')).toBe(true);
  });

  it('refuses writes, other origins and sibling prefixes', () => {
    expect(allowed('/artifacts/p1/data.json', 'POST')).toBe(false);
    expect(allowed('/artifacts/p1/data.json', 'DELETE')).toBe(false);
    expect(allowed('https://elsewhere.example/artifacts/p1/data.json')).toBe(false);
    expect(allowed('//elsewhere.example/artifacts/p1/data.json')).toBe(false);
    expect(allowed('/artifacts/p10/data.json')).toBe(false);
    expect(allowed('/api/projects')).toBe(false);
  });
});

describe('injectPreviewConnectCsp with a project policy', () => {
  afterEach(() => {
    // The guard test below patches globals; nothing here needs cleanup, but a
    // later test in this file must never inherit a stubbed fetch.
  });

  it('keeps the strict meta by default', () => {
    const out = injectPreviewConnectCsp('<html><head></head><body></body></html>');
    expect(out).toContain("content=\"connect-src 'none'\"");
    expect(out).not.toContain('data-od-artifact-network');
  });

  it('relaxes to self and installs the guard before authored scripts', () => {
    const out = injectPreviewConnectCsp(
      '<html><head><script>fetch("/api/projects")</script></head><body></body></html>',
      { policy: 'same-origin-readonly', paths: ['/artifacts/p1/'] },
    );
    expect(out).toContain("content=\"connect-src 'self'\"");
    expect(out).toContain('data-od-artifact-network="same-origin-readonly"');
    expect(out.indexOf('data-od-artifact-network="guard"')).toBeGreaterThan(-1);
    expect(out.indexOf('data-od-artifact-network="guard"')).toBeLessThan(
      out.indexOf('fetch("/api/projects")'),
    );
  });

  it('is idempotent for the relaxed policy', () => {
    const once = injectPreviewConnectCsp(
      '<html><head></head><body></body></html>',
      { policy: 'same-origin-readonly', paths: ['/artifacts/p1/'] },
    );
    const twice = injectPreviewConnectCsp(once, {
      policy: 'same-origin-readonly',
      paths: ['/artifacts/p1/'],
    });
    expect(twice).toBe(once);
  });

  it('enforces the policy at runtime', async () => {
    const out = injectPreviewConnectCsp(
      '<html><head></head><body></body></html>',
      { policy: 'same-origin-readonly', paths: ['/artifacts/p1/'] },
    );
    const source = out.match(/<script data-od-artifact-network="guard">([\s\S]*?)<\/script>/)?.[1];
    if (!source) throw new Error('guard script missing');

    const win = window as unknown as Record<string, unknown>;
    const saved = {
      fetch: win.fetch,
      XMLHttpRequest: win.XMLHttpRequest,
      WebSocket: win.WebSocket,
      EventSource: win.EventSource,
    };
    const calls: string[] = [];
    win.fetch = async (input: unknown) => {
      calls.push(String(input));
      return new Response('{}');
    };
    try {
      new Function(source)();
      await expect(window.fetch('/artifacts/p1/data.json')).resolves.toBeDefined();
      await expect(window.fetch('/api/projects')).rejects.toThrow(/artifact network policy/);
      await expect(window.fetch('/artifacts/p1/data.json', { method: 'POST' })).rejects.toThrow(
        /artifact network policy/,
      );
      await expect(window.fetch('/artifacts/p10/data.json')).rejects.toThrow(
        /artifact network policy/,
      );
      expect(calls).toEqual(['/artifacts/p1/data.json']);
      expect(() => new (window as any).WebSocket('ws://localhost:3000/live')).toThrow(
        /artifact network policy/,
      );
    } finally {
      win.fetch = saved.fetch;
      win.XMLHttpRequest = saved.XMLHttpRequest;
      win.WebSocket = saved.WebSocket;
      win.EventSource = saved.EventSource;
    }
  });

  it('serializes the guard as a dependency-free script', () => {
    const script = buildArtifactNetworkGuardScript({
      policy: 'same-origin-readonly',
      paths: ['/artifacts/p1/'],
    });
    expect(script.startsWith('<script')).toBe(true);
    expect(script).toContain('XMLHttpRequest');
    expect(script).toContain('EventSource');
    expect(script).toContain('sendBeacon');
    expect(script).not.toContain('import ');
  });
});
