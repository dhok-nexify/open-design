import { describe, expect, it } from 'vitest';

import { readPosthogConfig } from '../src/analytics.js';
import { telemetryAllowed } from '../src/edition/telemetry.js';
import { readLangfuseConfig } from '../src/langfuse-trace.js';

describe('edition telemetry gate', () => {
  it('allows telemetry upstream', () => {
    expect(telemetryAllowed({})).toBe(true);
    expect(telemetryAllowed({ OD_EDITION: 'upstream' })).toBe(true);
  });

  it('blocks telemetry in the NexTore edition', () => {
    expect(telemetryAllowed({ OD_EDITION: 'nextore' })).toBe(false);
  });

  it('fails closed on an unknown edition', () => {
    expect(() => telemetryAllowed({ OD_EDITION: 'bogus' })).toThrow(/Unsupported edition/);
  });

  it('readPosthogConfig returns null in the edition even with a key', () => {
    expect(readPosthogConfig({ OD_EDITION: 'nextore', POSTHOG_KEY: 'phc_test' })).toBeNull();
    expect(readPosthogConfig({ POSTHOG_KEY: 'phc_test' })?.key).toBe('phc_test');
  });

  it('readLangfuseConfig returns null in the edition even with keys', () => {
    const keys = { LANGFUSE_PUBLIC_KEY: 'pk', LANGFUSE_SECRET_KEY: 'sk' };
    expect(readLangfuseConfig({ OD_EDITION: 'nextore', ...keys })).toBeNull();
    expect(readLangfuseConfig(keys)).not.toBeNull();
  });
});
