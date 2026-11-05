import { afterEach, describe, expect, it, vi } from 'vitest';

// features.ts resolves the edition once at import time, so each case re-imports
// the router after setting the public env var.
describe('parseRoute — NexTore edition gates', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('keeps /automations upstream', async () => {
    vi.stubEnv('NEXT_PUBLIC_OD_EDITION', 'upstream');
    vi.resetModules();
    const { parseRoute } = await import('../src/router');

    expect(parseRoute('/automations')).toEqual({ kind: 'home', view: 'tasks' });
    expect(parseRoute('/tasks')).toEqual({ kind: 'home', view: 'tasks' });
  });

  it('mounts home instead of Automations in the NexTore edition', async () => {
    vi.stubEnv('NEXT_PUBLIC_OD_EDITION', 'nextore');
    vi.resetModules();
    const { parseRoute } = await import('../src/router');

    expect(parseRoute('/automations')).toEqual({ kind: 'home', view: 'home' });
    expect(parseRoute('/tasks')).toEqual({ kind: 'home', view: 'home' });
  });
});
