// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
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
});
