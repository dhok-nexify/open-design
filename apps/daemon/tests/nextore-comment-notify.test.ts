import { describe, expect, it, vi } from 'vitest';

import {
  buildCommentNoticePayload,
  notifyComment,
  notifyCommentSafely,
  resolveCommentRecipients,
} from '../src/nextore/comment-notify.js';

const base = {
  projectId: 'p1',
  commentId: 'c1',
  authorMemberId: 7,
  isReply: false,
  projectName: 'Landing',
  recipientIds: [7, 8, 8, 9],
};

describe('P05 comment notice payload', () => {
  it('removes the author, de-duplicates and keeps order', () => {
    expect(resolveCommentRecipients([7, 8, 8, 9, 0, -1], 7)).toEqual([8, 9]);
  });

  it('uses a stable idempotency key per comment', () => {
    const first = buildCommentNoticePayload(base);
    const retry = buildCommentNoticePayload({ ...base, recipientIds: [7, 8, 9] });
    expect(first.idempotencyKey).toBe('p1:c1');
    expect(retry.idempotencyKey).toBe(first.idempotencyKey);
    expect(first).toEqual({
      commentId: 'c1',
      authorMemberId: 7,
      isReply: false,
      projectName: 'Landing',
      recipientIds: [8, 9],
      idempotencyKey: 'p1:c1',
    });
  });
});

describe('P05 notifyComment', () => {
  function deps(fetchImpl: typeof fetch, token: string | null = 'tok') {
    return {
      moduleBaseUrl: 'https://module.test',
      accessToken: async () => token,
      fetchImpl,
    };
  }

  it('posts the contract payload with the API key', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;

    const outcome = await notifyComment(deps(fetchImpl), base);

    expect(outcome).toBe('sent');
    expect(calls[0]!.url).toBe('https://module.test/api/designer/projects/p1/comment-notifications');
    expect((calls[0]!.init.headers as Record<string, string>).APIkey).toBe('tok');
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({
      commentId: 'c1',
      authorMemberId: 7,
      isReply: false,
      recipientIds: [8, 9],
      idempotencyKey: 'p1:c1',
    });
  });

  it('does not call the module when the author is the only recipient', async () => {
    const fetchImpl = vi.fn();
    const outcome = await notifyComment(deps(fetchImpl as unknown as typeof fetch), {
      ...base,
      recipientIds: [7],
    });
    expect(outcome).toBe('skipped');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('treats 204 as a skipped notification', async () => {
    const fetchImpl = (async () => new Response(null, { status: 204 })) as unknown as typeof fetch;
    expect(await notifyComment(deps(fetchImpl), base)).toBe('skipped');
  });

  it('never throws when the module returns 5xx', async () => {
    const fetchImpl = (async () => new Response('boom', { status: 503 })) as unknown as typeof fetch;
    await expect(notifyComment(deps(fetchImpl), base)).resolves.toBe('failed');
  });

  it('never throws when the network fails', async () => {
    const fetchImpl = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    await expect(notifyComment(deps(fetchImpl), base)).resolves.toBe('failed');
  });

  it('skips when no access token is available', async () => {
    const fetchImpl = vi.fn();
    const outcome = await notifyComment(
      deps(fetchImpl as unknown as typeof fetch, null),
      base,
    );
    expect(outcome).toBe('skipped');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('falls back to the session store when the request carried no token', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      calls.push((init.headers as Record<string, string>).APIkey);
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const resolveMemberToken = vi.fn(async () => 'store-token');

    const outcome = await notifyComment(
      {
        moduleBaseUrl: 'https://module.test',
        accessToken: async () => null,
        resolveMemberToken,
        fetchImpl,
      },
      base,
    );

    expect(outcome).toBe('sent');
    expect(resolveMemberToken).toHaveBeenCalledWith(7);
    expect(calls).toEqual(['store-token']);
  });

  it('skips when neither the request nor the store has a token', async () => {
    const fetchImpl = vi.fn();
    const outcome = await notifyComment(
      {
        moduleBaseUrl: 'https://module.test',
        accessToken: async () => null,
        resolveMemberToken: async () => null,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      },
      base,
    );

    expect(outcome).toBe('skipped');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('skips when the module URL is unconfigured', async () => {
    const fetchImpl = vi.fn();
    const outcome = await notifyComment(
      { moduleBaseUrl: null, accessToken: async () => 'tok', fetchImpl: fetchImpl as unknown as typeof fetch },
      base,
    );
    expect(outcome).toBe('skipped');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('notifyCommentSafely (route seam)', () => {
  it('returns failed instead of throwing when fetch throws', async () => {
    const fetchImpl = (async () => { throw new Error('boom'); }) as unknown as typeof fetch;
    const outcome = await notifyCommentSafely(
      { moduleBaseUrl: 'https://module.test', accessToken: async () => 'tok', fetchImpl },
      base,
    );
    expect(outcome).toBe('failed');
  });

  it('returns failed instead of throwing when the token resolver throws', async () => {
    const fetchImpl = vi.fn();
    const outcome = await notifyCommentSafely(
      {
        moduleBaseUrl: 'https://module.test',
        accessToken: async () => { throw new Error('no token'); },
        fetchImpl: fetchImpl as unknown as typeof fetch,
      },
      base,
    );
    expect(outcome).toBe('failed');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns sent on the normal path', async () => {
    const fetchImpl = (async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
    const outcome = await notifyCommentSafely(
      { moduleBaseUrl: 'https://module.test', accessToken: async () => 'tok', fetchImpl },
      base,
    );
    expect(outcome).toBe('sent');
  });
});
