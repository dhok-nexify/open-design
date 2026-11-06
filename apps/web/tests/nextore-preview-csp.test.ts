import { describe, expect, it } from 'vitest';

import { injectPreviewConnectCsp } from '../src/runtime/srcdoc';

/**
 * The edition blocks artifact-originated API calls (NXD-D25, T-D96) with a
 * connect-src CSP. The meta has to precede any authored script, because a CSP
 * delivered by <meta> only governs requests made after it is parsed.
 */
describe('injectPreviewConnectCsp', () => {
  it('inserts the meta as early as possible in a full document', () => {
    const doc = '<!doctype html><html><head><script>fetch("/api/projects")</script></head><body></body></html>';
    const out = injectPreviewConnectCsp(doc);
    expect(out).toContain("content=\"connect-src 'none'\"");
    expect(out.indexOf('Content-Security-Policy')).toBeGreaterThan(-1);
    expect(out.indexOf('Content-Security-Policy')).toBeLessThan(out.indexOf('<script>'));
  });

  it('inserts into a fragment without a head', () => {
    const out = injectPreviewConnectCsp('<div>hello</div>');
    expect(out.startsWith('<meta')).toBe(true);
    expect(out).toContain('<div>hello</div>');
  });

  it('is idempotent', () => {
    const once = injectPreviewConnectCsp('<html><head></head><body></body></html>');
    const twice = injectPreviewConnectCsp(once);
    expect(twice.match(/Content-Security-Policy/g)).toHaveLength(1);
  });
});
