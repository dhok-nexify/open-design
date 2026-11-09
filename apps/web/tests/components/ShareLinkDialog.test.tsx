// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../../src/i18n';
import { ShareLinkDialog } from '../../src/components/ShareLinkDialog';
import { ShareLinkEntry } from '../../src/components/ShareLinkEntry';

const originalFetch = globalThis.fetch;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('ShareLinkDialog', () => {
  it('lists a link, creates one and revokes it', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const calls: Array<{ method: string; url: string }> = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      calls.push({ method, url });
      if (method === 'GET' && url.endsWith('/share-links')) {
        return jsonResponse({
          links: [
            {
              id: 'hash-1',
              createdAt: Date.now(),
              expiresAt: null,
              revokedAt: null,
            },
          ],
        });
      }
      if (method === 'POST' && url.endsWith('/share-links')) {
        return jsonResponse({
          link: {
            id: 'hash-2',
            url: 'https://designer.test/s/new-token',
            expiresAt: null,
          },
        });
      }
      if (method === 'DELETE' && url.includes('/share-links/hash-1')) {
        return jsonResponse({ ok: true });
      }
      return jsonResponse({}, 404);
    });

    render(
      <I18nProvider initial="en">
        <ShareLinkDialog projectId="proj-1" locale="en" onClose={() => {}} />
      </I18nProvider>,
    );

    await screen.findByText('Never');
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByDisplayValue('https://designer.test/s/new-token')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => {
      expect(calls.some((call) => call.method === 'DELETE'
        && call.url.includes('/share-links/hash-1'))).toBe(true);
    });
  });
});

describe('ShareLinkEntry', () => {
  it('redeems the token and hands the project id to the router', async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({ projectId: 'proj-42' }));
    const onResolved = vi.fn();
    render(
      <I18nProvider initial="en">
        <ShareLinkEntry
          token={'a'.repeat(32)}
          onResolved={onResolved}
          onHome={() => {}}
        />
      </I18nProvider>,
    );
    await waitFor(() => expect(onResolved).toHaveBeenCalledWith('proj-42'));
  });
});
