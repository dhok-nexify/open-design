// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../../src/i18n';
import { ProjectPermissionsDialog } from '../../src/nextore/ProjectPermissionsDialog';

const snapshot = {
  exists: true,
  canManage: true,
  isInherit: true,
  customized: [
    {
      recordId: 1,
      recordType: 'owner',
      name: 'AdminUser',
      inherited: false,
      rights: { manage: true, read: true, edit: true, delete: true, download: true, checkOut: true, createFile: true, createFolder: true },
    },
    {
      recordId: 42,
      recordType: 'group',
      name: 'Design Team',
      inherited: false,
      rights: { manage: false, read: true, edit: false, delete: false, download: false, checkOut: false, createFile: false, createFolder: false },
    },
  ],
  inherited: [
    {
      recordId: 9,
      recordType: 'group',
      name: 'Workspace Readers',
      inherited: true,
      rights: { manage: false, read: true, edit: false, delete: false, download: false, checkOut: false, createFile: false, createFolder: false },
    },
  ],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function renderDialog() {
  return render(
    <I18nProvider initial="en">
      <ProjectPermissionsDialog projectId="project-1" open onClose={() => {}} />
    </I18nProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ProjectPermissionsDialog', () => {
  it('renders the native matrix, inherited rows and dependency rules', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(snapshot));
    vi.stubGlobal('fetch', fetchMock);

    renderDialog();

    await screen.findByText('Project permissions');
    for (const heading of ['Manage', 'Read', 'Edit', 'Delete', 'Download', 'Lock', 'Create file', 'Create folder']) {
      expect(screen.getAllByRole('columnheader', { name: heading }).length).toBeGreaterThan(0);
    }
    expect(screen.getByText('AdminUser')).toBeTruthy();
    expect(screen.getByText('Workspace Readers')).toBeTruthy();

    const ownerManage = screen.getByLabelText('Manage — AdminUser') as HTMLInputElement;
    expect(ownerManage.disabled).toBe(true);
    const inheritedRead = screen.getByLabelText('Read — Workspace Readers') as HTMLInputElement;
    expect(inheritedRead.disabled).toBe(true);

    const edit = screen.getByLabelText('Edit — Design Team') as HTMLInputElement;
    fireEvent.click(edit);
    expect((screen.getByLabelText('Download — Design Team') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('Read — Design Team') as HTMLInputElement).checked).toBe(true);
  });

  it('adds a group from the picker and posts the matrix', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/permission-groups')) {
        return jsonResponse({ groups: [{ id: 7, name: 'Content Group', parentId: 0 }] });
      }
      if (url.includes('/permission-members')) {
        return jsonResponse({ members: [] });
      }
      if (url.endsWith('/permissions') && init?.method === 'POST') {
        return jsonResponse({ ok: true });
      }
      return jsonResponse(snapshot);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderDialog();
    await screen.findByText('Project permissions');

    fireEvent.click(screen.getByRole('button', { name: /Group \/ Member/ }));
    await screen.findByText('Add group or member');
    await screen.findByText('Content Group');
    const groupCheckbox = screen.getByLabelText('Content Group') as HTMLInputElement;
    fireEvent.click(groupCheckbox);
    expect(groupCheckbox.checked).toBe(true);
    const addButton = screen.getByRole('button', { name: 'Add selected' }) as HTMLButtonElement;
    expect(addButton.disabled).toBe(false);
    fireEvent.click(addButton);

    await waitFor(() => expect(screen.getByText('Content Group')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/projects/project-1/permissions',
      expect.objectContaining({ method: 'POST' }),
    ));
    const postCall = fetchMock.mock.calls.find(([url, init]) =>
      String(url) === '/api/projects/project-1/permissions' && init?.method === 'POST');
    const body = JSON.parse(String(postCall?.[1]?.body));
    expect(body.isInherit).toBe(true);
    expect(body.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ recordType: 'group', recordId: 7 }),
    ]));
  });
});
