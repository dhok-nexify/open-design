// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../../src/i18n';
import { ArtifactShareDialog } from '../../src/components/nextore/ArtifactShareDialog';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderDialog(onClose = vi.fn()) {
  render(
    <I18nProvider initial="en">
      <ArtifactShareDialog projectId="p1" artifactId="a1" onClose={onClose} />
    </I18nProvider>,
  );
  return onClose;
}

describe('ArtifactShareDialog', () => {
  it('creates a NexTore link with the chosen options and shows the URL', async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
      return new Response(JSON.stringify({
        url: 'https://share.test/s/abc',
        representation: 'snapshot',
        previewOnly: true,
        pinnedVersion: null,
        expiresAt: null,
        hasPassword: false,
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }));

    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Create link' }));

    await waitFor(() => expect(screen.getByDisplayValue('https://share.test/s/abc')).toBeTruthy());
    expect(calls[0]!.url).toBe('/api/nextore/projects/p1/artifacts/a1/share');
    expect(calls[0]!.body).toMatchObject({ representation: 'snapshot', previewOnly: true });
  });

  it('tells the user pinned links are unavailable', () => {
    renderDialog();
    expect(screen.getByText(/Pinned links are not supported yet/)).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: /pin/i })).toBeNull();
  });

  it('closes on Escape and on the close button', () => {
    const onClose = renderDialog();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('shows the link as a labelled, read-only field after creation', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      url: 'https://share.test/s/xyz',
      representation: 'snapshot',
      previewOnly: true,
      pinnedVersion: null,
      expiresAt: null,
      hasPassword: false,
    }), { status: 200, headers: { 'content-type': 'application/json' } })));

    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Create link' }));

    const field = await screen.findByDisplayValue('https://share.test/s/xyz');
    expect(field.getAttribute('readonly')).not.toBeNull();
    expect(screen.getByText('Share link')).toBeTruthy();
  });
});
