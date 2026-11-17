// @vitest-environment jsdom
/**
 * The edition's project entries (NXD-D12 permission editor, NXD-D20 revocable
 * share link) and the quarantine notice must stay reachable. The upstream
 * project-header rewrite removed the call sites while leaving the handlers in
 * place, so this test pins both the component behaviour and the mount points
 * that keep it on screen.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  NextoreProjectActions,
  NextoreProjectQuarantineNotice,
} from '../../src/nextore/project-actions';
import { I18nProvider } from '../../src/i18n';
import { LOCAL_PROJECT_ACCESS, type NextoreProjectAccessView } from '../../src/nextore/access';

const projectViewSource = readFileSync(
  resolve(process.cwd(), 'src/components/ProjectView.tsx'),
  'utf8',
);
const fileWorkspaceSource = readFileSync(
  resolve(process.cwd(), 'src/components/FileWorkspace.tsx'),
  'utf8',
);
const fileViewerSource = readFileSync(
  resolve(process.cwd(), 'src/components/FileViewer.tsx'),
  'utf8',
);

afterEach(() => cleanup());

function renderActions(access: NextoreProjectAccessView | null) {
  const onOpenShareLinks = vi.fn();
  const onOpenPermissions = vi.fn();
  render(
    <I18nProvider initial="en">
      <NextoreProjectActions
        access={access}
        onOpenShareLinks={onOpenShareLinks}
        onOpenPermissions={onOpenPermissions}
      />
    </I18nProvider>,
  );
  return { onOpenShareLinks, onOpenPermissions };
}

describe('NexTore project entries', () => {
  it('offers the share link to a manager and opens the dialog', () => {
    const { onOpenShareLinks } = renderActions(LOCAL_PROJECT_ACCESS);

    const share = screen.getByTestId('nextore-share-link');
    expect(share).toHaveTextContent('Get a share link');
    expect(share).toHaveAttribute('type', 'button');
    fireEvent.click(share);
    expect(onOpenShareLinks).toHaveBeenCalledTimes(1);
  });

  it('hides the share link when the module disables it or the member cannot manage', () => {
    cleanup();
    renderActions({ ...LOCAL_PROJECT_ACCESS, shareLinksEnabled: false });
    expect(screen.queryByTestId('nextore-share-link')).toBeNull();
    expect(screen.getByTestId('nextore-manage-permissions')).toBeTruthy();

    cleanup();
    renderActions({ ...LOCAL_PROJECT_ACCESS, canManage: false });
    expect(screen.queryByTestId('nextore-share-link')).toBeNull();
  });

  it('always offers the permission editor entry', () => {
    const { onOpenPermissions } = renderActions(null);

    const permissions = screen.getByTestId('nextore-manage-permissions');
    expect(permissions).toHaveTextContent('Permissions');
    fireEvent.click(permissions);
    expect(onOpenPermissions).toHaveBeenCalledTimes(1);
  });

  it('shows the quarantine notice with its message', () => {
    render(
      <NextoreProjectQuarantineNotice message="This project is no longer in NexTore." />,
    );

    expect(screen.getByTestId('nextore-project-quarantined')).toHaveTextContent(
      'This project is no longer in NexTore.',
    );
  });

  it('keeps both entries mounted from the workspace tab bar', () => {
    // The regression was a missing call site, not a missing component.
    expect(projectViewSource).toContain('<NextoreProjectActions');
    expect(projectViewSource).toContain('access={nextoreProjectAccess}');
    expect(projectViewSource).toContain('onOpenShareLinks={() => setShareDialogOpen(true)}');
    expect(projectViewSource).toContain('onOpenPermissions={() => { void openNextorePermissions(); }}');
    expect(projectViewSource).toContain(
      "quarantineNotice={projectQuarantined ? t('workspace.projectQuarantined') : undefined}",
    );
    expect(fileWorkspaceSource).toContain(
      '<NextoreProjectQuarantineNotice message={quarantineNotice} />',
    );
  });

  it('hides the cloud artifact Share tab in the NexTore edition', () => {
    expect(fileViewerSource).toContain("const artifactCloudShareAvailable = isFeatureEnabled('collab-cloud');");
    expect(fileViewerSource).toContain('{artifactCloudShareAvailable ? <button');
    expect(fileViewerSource).toContain(
      'unifiedActionTab === \'share\' && rawCanShare && artifactCloudShareAvailable ? (',
    );
  });
});
