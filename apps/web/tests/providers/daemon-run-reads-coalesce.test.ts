import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetCoalescedGet } from '../../src/lib/coalesced-get';
import {
  listActiveChatRuns,
  listProjectRunsWithScope,
} from '../../src/providers/daemon';

function okJson(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

describe('run read coalescing', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    resetCoalescedGet();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shares one request for concurrent identical active-run reads', async () => {
    fetchMock.mockResolvedValue(okJson({ runs: [] }));

    const [a, b] = await Promise.all([
      listActiveChatRuns('proj-1', 'conv-1'),
      listActiveChatRuns('proj-1', 'conv-1'),
    ]);

    expect(a).toEqual([]);
    expect(b).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.priority).toBe('low');
  });

  it('does not share across different conversations', async () => {
    fetchMock.mockResolvedValue(okJson({ runs: [] }));

    await Promise.all([
      listActiveChatRuns('proj-1', 'conv-1'),
      listActiveChatRuns('proj-1', 'conv-2'),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('shares the settled result inside the coalesce window', async () => {
    fetchMock.mockResolvedValue(okJson({ runs: [] }));

    await listProjectRunsWithScope(null, 'proj-1');
    await listProjectRunsWithScope(null, 'proj-1');

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('never caches a failed read', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    fetchMock.mockResolvedValueOnce(okJson({ runs: [] }));

    const first = await listProjectRunsWithScope(null, 'proj-9');
    const second = await listProjectRunsWithScope(null, 'proj-9');

    expect(first).toEqual({ runs: [], scopeRequired: false });
    expect(second).toEqual({ runs: [], scopeRequired: false });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
