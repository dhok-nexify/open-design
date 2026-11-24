// @vitest-environment jsdom
/**
 * The artifact dialog is bound to one file, so its heading has to name that
 * file. A project with several pages otherwise shows the same dialog for every
 * row and nobody can tell which page a link belongs to.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../../src/i18n';
import { NextoreArtifactDialog } from '../../src/components/nextore/NextoreArtifactDialog';

vi.mock('../../src/nextore/artifact-client', () => ({
  fetchProjectArtifacts: vi.fn(async () => []),
  primaryArtifact: () => null,
  artifactDownloadUrl: () => '',
}));

afterEach(() => cleanup());

function renderDialog(artifactId?: string) {
  render(
    <I18nProvider initial="en">
      <NextoreArtifactDialog projectId="p1" {...(artifactId ? { artifactId } : {})} onClose={() => {}} />
    </I18nProvider>,
  );
}

describe('NextoreArtifactDialog heading', () => {
  it('names the file it is bound to', async () => {
    renderDialog('equity-report.html');
    expect(await screen.findByText('equity-report.html')).toBeTruthy();
    expect(screen.getByRole('dialog').getAttribute('aria-labelledby')).toBe(
      'nextore-project-artifact-title nextore-project-artifact-file',
    );
  });

  it('stays unnamed for the project-level legacy entry', () => {
    renderDialog();
    expect(screen.queryByText('equity-report.html')).toBeNull();
    expect(screen.getByRole('dialog').getAttribute('aria-labelledby')).toBe(
      'nextore-project-artifact-title',
    );
  });
});
