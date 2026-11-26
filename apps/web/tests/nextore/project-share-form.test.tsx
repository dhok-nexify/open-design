// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../../src/i18n';
import { ProjectShareForm } from '../../src/components/nextore/ProjectShareForm';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderForm() {
  render(
    <I18nProvider initial="en">
      <ProjectShareForm projectId="p1" />
    </I18nProvider>,
  );
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('ProjectShareForm', () => {
  it('renders the create action after the initial read resolves', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ shared: false, url: null }));
    vi.stubGlobal('fetch', fetchMock);

    // Before the read resolves the form renders nothing. Once the state lands it
    // must keep the same hook order; a hook declared after the early return made
    // React throw #310 and took the whole project page down with it.
    renderForm();

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Create project link' })).toBeTruthy(),
    );
    expect(fetchMock).toHaveBeenCalledWith('/api/nextore/projects/p1/share', {
      headers: { accept: 'application/json' },
    });
  });

  it('shows the link the daemon returns and keeps it after the dialog reopens', async () => {
    const sharedUrl = 'https://designer.test/share?key=abc';
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ shared: true, url: sharedUrl })));

    renderForm();
    const first = await screen.findByDisplayValue(sharedUrl);
    expect((first as HTMLInputElement).value).toBe(sharedUrl);

    // Reopening mounts a fresh form. The read must render the identical string;
    // a project (folder) link must never fall back to the platform URL, which
    // renders an empty document viewer.
    cleanup();
    renderForm();
    const second = await screen.findByDisplayValue(sharedUrl);
    expect((second as HTMLInputElement).value).toBe(sharedUrl);
  });

  it('renders the created link exactly as the create call returned it', async () => {
    const sharedUrl = 'https://designer.test/share?key=created';
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return jsonResponse({
          url: sharedUrl,
          scope: 'project',
          previewOnly: true,
          expiresAt: null,
          hasPassword: false,
        });
      }
      return jsonResponse({ shared: false, url: null });
    }));

    renderForm();
    fireEvent.click(await screen.findByRole('button', { name: 'Create project link' }));

    const input = await screen.findByDisplayValue(sharedUrl);
    expect((input as HTMLInputElement).value).toBe(sharedUrl);
  });
});
