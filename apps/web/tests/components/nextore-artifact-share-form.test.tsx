// @vitest-environment jsdom
/**
 * A share link outlives the dialog that minted it. Reopening the dialog has
 * to show the link that already exists, otherwise the only reachable action
 * is "create another link" and the live one can never be revoked.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../../src/i18n';
import { ArtifactShareForm } from '../../src/components/nextore/ArtifactShareForm';

const describeArtifactShare = vi.fn();
vi.mock('../../src/nextore/artifact-client', () => ({
  describeArtifactShare: (...args: unknown[]) => describeArtifactShare(...args),
  shareArtifact: vi.fn(),
  revokeArtifactShare: vi.fn(),
  renderSnapshot: vi.fn(),
  waitForSnapshot: vi.fn(),
}));

afterEach(() => {
  cleanup();
  describeArtifactShare.mockReset();
});

function renderForm() {
  render(
    <I18nProvider initial="en">
      <ArtifactShareForm projectId="p1" artifactId="equity-report.html" />
    </I18nProvider>,
  );
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
    describeArtifactShare.mockResolvedValue({
      projectId: 'p1',
      artifactId: 'equity-report.html',
      representation: 'snapshot',
      shared: false,
      url: null,
    });
    renderForm();
    await waitFor(() => expect(describeArtifactShare).toHaveBeenCalled());
    expect(screen.queryByDisplayValue('https://share.test/PublicShare?key=existing')).toBeNull();
  });
});
