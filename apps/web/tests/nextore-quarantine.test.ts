import { afterEach, describe, expect, it } from 'vitest';
import {
  fetchQuarantinedProjectIds,
  resetQuarantinedProjectCache,
} from '../src/nextore/quarantine';

// NXD-D08: the UI has to know which projects NexTore no longer lists, and a
// failed lookup must never produce a banner about a project that is fine.

afterEach(() => {
  resetQuarantinedProjectCache();
});

function stubFetch(body: unknown, init: { ok?: boolean; throws?: boolean } = {}) {
  const calls: string[] = [];
  const impl = (async (input: unknown) => {
    calls.push(String(input));
    if (init.throws) throw new Error('offline');
    return {
      ok: init.ok ?? true,
      json: async () => body,
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe('fetchQuarantinedProjectIds', () => {
  it('reads the candidate ids and caches the answer for the page load', async () => {
    const stub = stubFetch({ candidates: [{ projectId: 'p1' }, { projectId: 'p2' }, {}] });
    const first = await fetchQuarantinedProjectIds(stub.impl);
    expect([...first].sort()).toEqual(['p1', 'p2']);
    const second = await fetchQuarantinedProjectIds(stub.impl);
    expect(second).toBe(first);
    expect(stub.calls).toHaveLength(1);
  });

  it('answers nothing when the daemon refuses', async () => {
    const stub = stubFetch({}, { ok: false });
    expect((await fetchQuarantinedProjectIds(stub.impl)).size).toBe(0);
  });

  it('answers nothing when the request throws', async () => {
    const stub = stubFetch({}, { throws: true });
    expect((await fetchQuarantinedProjectIds(stub.impl)).size).toBe(0);
  });
});
