// @vitest-environment jsdom
/**
 * Sharing has two rules that are easy to break from the UI side:
 * 1. a link outlives the dialog, so reopening must show it;
 * 2. NexTore can only preview PDF-like documents, so a source HTML link
 *    must never be preview-only (the visitor would see an empty page).
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../../src/i18n';
import { ArtifactShareForm } from '../../src/components/nextore/ArtifactShareForm';

const describeArtifactShare = vi.fn();
const shareArtifact = vi.fn();
vi.mock('../../src/nextore/artifact-client', () => ({
  describeArtifactShare: (...args: unknown[]) => describeArtifactShare(...args),
  shareArtifact: (...args: unknown[]) => shareArtifact(...args),
  revokeArtifactShare: vi.fn(),
  renderSnapshot: vi.fn(),
  waitForSnapshot: vi.fn(),
}));

afterEach(() => {
  cleanup();
  describeArtifactShare.mockReset();
  shareArtifact.mockReset();
});

function renderForm() {
  render(
    <I18nProvider initial="en">
      <ArtifactShareForm projectId="p1" artifactId="equity-report.html" />
    </I18nProvider>,
  );
}

function notShared() {
  describeArtifactShare.mockResolvedValue({
    projectId: 'p1',
    artifactId: 'equity-report.html',
    representation: 'snapshot',
    shared: false,
    url: null,
  });
}

describe('ArtifactShareForm link read-back', () => {
  it('shows the link that already exists instead of the create form', async () => {
    describeArtifactShare.mockResolvedValue({
      projectId: 'p1',
      artifactId: 'equity-report.html',
      representation: 'snapshot',
      shared: true,
      url: 'https://share.test/PublicShare?key=existing',
    });
    renderForm();
    expect(await screen.findByDisplayValue('https://share.test/PublicShare?key=existing')).toBeTruthy();
    expect(describeArtifactShare).toHaveBeenCalledWith('p1', 'equity-report.html', 'snapshot');
  });

  it('falls back to the create form when nothing is shared yet', async () => {
    notShared();
    renderForm();
    await waitFor(() => expect(describeArtifactShare).toHaveBeenCalled());
    expect(screen.queryByDisplayValue('https://share.test/PublicShare?key=existing')).toBeNull();
  });
});

describe('ArtifactShareForm source representation', () => {
  it('forces a download link so the shared page is never blank', async () => {
    notShared();
    shareArtifact.mockResolvedValue({
      url: 'https://share.test/PublicShare?key=source',
      representation: 'source',
      previewOnly: false,
      pinnedVersion: null,
      expiresAt: null,
      hasPassword: false,
    });
    renderForm();
    await screen.findByRole('button', { name: /create/i });
    const representation = screen.getByLabelText(/version/i);
    fireEvent.change(representation, { target: { value: 'source' } });
    // Switching the representation re-reads the link for that representation.
    const createButton = await screen.findByRole('button', { name: /create/i });
    const previewOnly = screen.getByRole('checkbox') as HTMLInputElement;
    expect(previewOnly.checked).toBe(false);
    expect(previewOnly.disabled).toBe(true);
    fireEvent.click(createButton);
    await waitFor(() => expect(shareArtifact).toHaveBeenCalled());
    expect(shareArtifact).toHaveBeenCalledWith('p1', 'equity-report.html', expect.objectContaining({
      representation: 'source',
      previewOnly: false,
    }));
  });
});
