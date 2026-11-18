import { describe, expect, it, vi } from 'vitest';

import type { NextoreProjectPermissionRights } from '@open-design/contracts';
import {
  applyPermissionDependencies,
  emptyPermissionRights,
  fetchProjectPermissions,
  normalizePermissionGroups,
  normalizePermissionMembers,
  normalizeProjectPermissions,
  permissionCellDisabled,
} from '../src/nextore/project-permissions';

function rights(overrides: Partial<NextoreProjectPermissionRights>): NextoreProjectPermissionRights {
  return { ...emptyPermissionRights(), ...overrides };
}

describe('project permission dependencies', () => {
  it('makes Manage imply every other right', () => {
    expect(applyPermissionDependencies(rights({ manage: true }))).toEqual({
      manage: true,
      read: true,
      edit: true,
      delete: true,
      download: true,
      checkOut: true,
      createFile: true,
      createFolder: true,
    });
  });

  it('makes Lock imply Edit and Download, and any right imply Read', () => {
    expect(applyPermissionDependencies(rights({ checkOut: true }))).toMatchObject({
      checkOut: true,
      edit: true,
      download: true,
      read: true,
    });
    expect(applyPermissionDependencies(rights({ delete: true }))).toMatchObject({
      delete: true,
      read: true,
    });
  });

  it('disables dependent cells while their parent right is on', () => {
    expect(permissionCellDisabled(rights({ manage: true }), 'read')).toBe(true);
    expect(permissionCellDisabled(rights({ edit: true }), 'download')).toBe(true);
    expect(permissionCellDisabled(rights({ checkOut: true }), 'edit')).toBe(true);
    expect(permissionCellDisabled(rights({ read: true }), 'edit')).toBe(false);
  });
});

describe('project permission normalization', () => {
  it('keeps valid customized and inherited rows', () => {
    expect(normalizeProjectPermissions({
      exists: true,
      canManage: true,
      isInherit: true,
      customized: [{
        recordId: 1,
        recordType: 'owner',
        name: 'Owner',
        inherited: false,
        rights: { manage: true, read: true },
      }],
      inherited: [{
        recordId: 2,
        recordType: 'group',
        name: 'Team',
        inherited: true,
        rights: { read: true },
      }],
    })).toEqual({
      exists: true,
      canManage: true,
      isInherit: true,
      customized: [expect.objectContaining({ recordId: 1, recordType: 'owner' })],
      inherited: [expect.objectContaining({ recordId: 2, recordType: 'group' })],
    });
  });

  it('reads the module payload when its properties are PascalCase', () => {
    // The module serialises C# records as-is (ProjectPermissionSnapshot,
    // PermissionGroupSummary, PermissionMemberSummary), while this file's
    // first tests used the camelCase spelling the daemon uses elsewhere. Both
    // must land in the same shape or the drawer reads CanManage as false and
    // renders a read-only matrix for a manager.
    expect(normalizeProjectPermissions({
      Exists: true,
      CanManage: true,
      IsInherit: false,
      Customized: [{
        RecordId: 11,
        RecordType: 'group',
        Name: 'Design',
        Inherited: false,
        Rights: { Manage: true, Read: true, Edit: true, CheckOut: true },
      }],
      Inherited: [{
        RecordId: 12,
        RecordType: 'member',
        Name: 'Ann',
        Inherited: true,
        Rights: { Read: true, Download: true },
      }],
    })).toEqual({
      exists: true,
      canManage: true,
      isInherit: false,
      customized: [{
        recordId: 11,
        recordType: 'group',
        name: 'Design',
        inherited: false,
        rights: expect.objectContaining({
          manage: true,
          read: true,
          edit: true,
          checkOut: true,
          delete: false,
          createFile: false,
        }),
      }],
      inherited: [{
        recordId: 12,
        recordType: 'member',
        name: 'Ann',
        inherited: true,
        rights: expect.objectContaining({ read: true, download: true, manage: false }),
      }],
    });
  });

  it('reads PascalCase group and member payloads', () => {
    expect(normalizePermissionGroups({
      Groups: [
        { Id: 3, Name: 'Operations', ParentId: 0 },
        { Id: 4, Name: 'Ops / Design', ParentId: 3 },
      ],
      Truncated: true,
    })).toEqual({
      groups: [
        { id: 3, name: 'Operations', parentId: 0 },
        { id: 4, name: 'Ops / Design', parentId: 3 },
      ],
      truncated: true,
    });
    expect(normalizePermissionMembers({
      Members: [{ Id: 21, Login: 'reader', FullName: 'Reader', Email: 'reader@example.test' }],
    })).toEqual([{ id: 21, login: 'reader', fullName: 'Reader', email: 'reader@example.test' }]);
  });

  it('drops malformed rows and defaults unknown flags to false', () => {
    const normalized = normalizeProjectPermissions({
      customized: [
        { recordId: 0, recordType: 'owner' },
        { recordId: 3, recordType: 'unknown' },
        { recordId: 4, recordType: 'member', rights: { edit: true } },
      ],
    });
    expect(normalized?.customized).toHaveLength(1);
    expect(normalized?.customized[0]).toMatchObject({
      recordId: 4,
      recordType: 'member',
      rights: expect.objectContaining({ edit: true, manage: false, read: false }),
    });
  });

  it('normalizes group trees and member directories', () => {
    expect(normalizePermissionGroups({
      groups: [
        { id: 7, name: 'Design', parentId: 0 },
        { id: 8, name: 'Nested', parentId: 7 },
        { id: 0, name: 'Invalid' },
      ],
      truncated: true,
    })).toEqual({
      groups: [
        { id: 7, name: 'Design', parentId: 0 },
        { id: 8, name: 'Nested', parentId: 7 },
      ],
      truncated: true,
    });
    expect(normalizePermissionMembers({
      members: [{ id: 9, login: 'ann', fullName: 'Ann', email: 'ann@example.test' }],
    })).toEqual([{ id: 9, login: 'ann', fullName: 'Ann', email: 'ann@example.test' }]);
  });

  it('requests the mapped project permission endpoint', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      exists: true,
      canManage: true,
      isInherit: true,
      customized: [],
      inherited: [],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    await fetchProjectPermissions('project-1', fetchMock as unknown as typeof fetch);

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/projects/project-1/permissions',
      expect.objectContaining({
        headers: expect.objectContaining({ accept: 'application/json' }),
      }),
    );
  });
});
