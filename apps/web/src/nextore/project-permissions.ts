'use client';

import type {
  NextorePermissionGroup,
  NextorePermissionMember,
  NextoreProjectPermissionItem,
  NextoreProjectPermissionRights,
  NextoreProjectPermissions,
  SaveNextoreProjectPermissionsRequest,
} from '@open-design/contracts';

export type PermissionRightKey = keyof NextoreProjectPermissionRights;

const RIGHT_KEYS: PermissionRightKey[] = [
  'manage',
  'read',
  'edit',
  'delete',
  'download',
  'checkOut',
  'createFile',
  'createFolder',
];

export function emptyPermissionRights(): NextoreProjectPermissionRights {
  return {
    manage: false,
    read: false,
    edit: false,
    delete: false,
    download: false,
    checkOut: false,
    createFile: false,
    createFolder: false,
  };
}

/**
 * The native permission page's dependency rules, kept as one pure function so
 * the React matrix and its tests cannot drift:
 * - Manage implies every right.
 * - Lock implies Edit; Edit implies Download.
 * - Any granted right implies Read.
 */
export function applyPermissionDependencies(
  rights: NextoreProjectPermissionRights,
): NextoreProjectPermissionRights {
  const next = { ...rights };
  if (next.manage) {
    for (const key of RIGHT_KEYS) next[key] = true;
    return next;
  }

  if (next.checkOut) next.edit = true;
  if (next.edit) next.download = true;
  if (
    next.edit
    || next.delete
    || next.download
    || next.checkOut
    || next.createFile
    || next.createFolder
  ) {
    next.read = true;
  }
  return next;
}

/** A dependent cell cannot be unchecked while its parent right is on. */
export function permissionCellDisabled(
  rights: NextoreProjectPermissionRights,
  key: PermissionRightKey,
): boolean {
  if (key === 'manage') return false;
  if (rights.manage) return true;
  if (key === 'read') {
    return rights.edit
      || rights.delete
      || rights.download
      || rights.checkOut
      || rights.createFile
      || rights.createFolder;
  }
  if (key === 'edit') return rights.checkOut;
  if (key === 'download') return rights.edit || rights.checkOut;
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Reads one field that the module may spell in either JSON casing.
 *
 * The module serialises its C# records with PascalCase property names while
 * the wire helpers elsewhere in the daemon already accept both spellings. The
 * permission endpoints forward the module body untouched, so the drawer must
 * accept the same pair or every flag reads as missing.
 */
function pick(record: Record<string, unknown>, camel: string, pascal: string): unknown {
  return record[camel] ?? record[pascal];
}

function asBoolean(record: Record<string, unknown>, camel: string, pascal: string): boolean {
  return pick(record, camel, pascal) === true;
}

function asNumberField(
  record: Record<string, unknown>,
  camel: string,
  pascal: string,
): number | null {
  return asPositiveInt(pick(record, camel, pascal));
}

function asPositiveInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

function normalizeRights(value: unknown): NextoreProjectPermissionRights {
  const rights = isRecord(value) ? value : {};
  return {
    manage: asBoolean(rights, 'manage', 'Manage'),
    read: asBoolean(rights, 'read', 'Read'),
    edit: asBoolean(rights, 'edit', 'Edit'),
    delete: asBoolean(rights, 'delete', 'Delete'),
    download: asBoolean(rights, 'download', 'Download'),
    checkOut: asBoolean(rights, 'checkOut', 'CheckOut'),
    createFile: asBoolean(rights, 'createFile', 'CreateFile'),
    createFolder: asBoolean(rights, 'createFolder', 'CreateFolder'),
  };
}

function normalizePermissionItem(value: unknown): NextoreProjectPermissionItem | null {
  if (!isRecord(value)) return null;
  const recordId = asNumberField(value, 'recordId', 'RecordId');
  const recordType = pick(value, 'recordType', 'RecordType');
  if (recordId === null) return null;
  if (recordType !== 'owner' && recordType !== 'group' && recordType !== 'member') return null;
  return {
    recordId,
    recordType,
    name: asString(pick(value, 'name', 'Name')),
    inherited: asBoolean(value, 'inherited', 'Inherited'),
    rights: normalizeRights(pick(value, 'rights', 'Rights')),
  };
}

export function normalizeProjectPermissions(value: unknown): NextoreProjectPermissions | null {
  if (!isRecord(value)) return null;
  const customizedValue = pick(value, 'customized', 'Customized');
  const inheritedValue = pick(value, 'inherited', 'Inherited');
  const customized = Array.isArray(customizedValue)
    ? customizedValue.map(normalizePermissionItem).filter((item): item is NextoreProjectPermissionItem => Boolean(item))
    : [];
  const inherited = Array.isArray(inheritedValue)
    ? inheritedValue.map(normalizePermissionItem).filter((item): item is NextoreProjectPermissionItem => Boolean(item))
    : [];
  return {
    exists: asBoolean(value, 'exists', 'Exists'),
    canManage: asBoolean(value, 'canManage', 'CanManage'),
    isInherit: asBoolean(value, 'isInherit', 'IsInherit'),
    customized,
    inherited,
  };
}

export interface PermissionGroupsResult {
  groups: NextorePermissionGroup[];
  truncated: boolean;
}

export function normalizePermissionGroups(value: unknown): PermissionGroupsResult {
  const entries = isRecord(value) ? pick(value, 'groups', 'Groups') : null;
  if (!Array.isArray(entries)) {
    return { groups: [], truncated: false };
  }
  const groups: NextorePermissionGroup[] = [];
  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    const id = asNumberField(entry, 'id', 'Id');
    if (id === null) continue;
    groups.push({
      id,
      name: asString(pick(entry, 'name', 'Name')),
      parentId: asNumberField(entry, 'parentId', 'ParentId') ?? 0,
    });
  }
  return { groups, truncated: isRecord(value) && asBoolean(value, 'truncated', 'Truncated') };
}

export function normalizePermissionMembers(value: unknown): NextorePermissionMember[] {
  const entries = isRecord(value) ? pick(value, 'members', 'Members') : null;
  if (!Array.isArray(entries)) return [];
  const members: NextorePermissionMember[] = [];
  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    const id = asNumberField(entry, 'id', 'Id');
    if (id === null) continue;
    members.push({
      id,
      login: asString(pick(entry, 'login', 'Login')),
      fullName: asString(pick(entry, 'fullName', 'FullName')),
      email: asString(pick(entry, 'email', 'Email')),
    });
  }
  return members;
}

async function requestJson(
  url: string,
  init: RequestInit | undefined,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  const response = await fetchImpl(url, {
    ...init,
    headers: {
      accept: 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as
      | { error?: { message?: unknown; code?: unknown } }
      | null;
    const message = typeof body?.error?.message === 'string'
      ? body.error.message
      : typeof body?.error?.code === 'string'
        ? body.error.code
        : 'HTTP ' + response.status;
    throw new Error(message);
  }
  return response.json();
}

export async function fetchProjectPermissions(
  projectId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<NextoreProjectPermissions> {
  const result = normalizeProjectPermissions(await requestJson(
    '/api/projects/' + encodeURIComponent(projectId) + '/permissions',
    undefined,
    fetchImpl,
  ));
  if (!result) throw new Error('invalid_permissions_response');
  return result;
}

export async function saveProjectPermissions(
  projectId: string,
  body: SaveNextoreProjectPermissionsRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  await requestJson(
    '/api/projects/' + encodeURIComponent(projectId) + '/permissions',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
    fetchImpl,
  );
}

export async function fetchPermissionGroups(
  projectId: string,
  query: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PermissionGroupsResult> {
  const suffix = query.trim() ? '?query=' + encodeURIComponent(query.trim()) : '';
  return normalizePermissionGroups(await requestJson(
    '/api/projects/' + encodeURIComponent(projectId) + '/permission-groups' + suffix,
    undefined,
    fetchImpl,
  ));
}

export async function fetchPermissionMembers(
  projectId: string,
  query: string,
  fetchImpl: typeof fetch = fetch,
): Promise<NextorePermissionMember[]> {
  if (!query.trim()) return [];
  return normalizePermissionMembers(await requestJson(
    '/api/projects/' + encodeURIComponent(projectId)
      + '/permission-members?query=' + encodeURIComponent(query.trim()),
    undefined,
    fetchImpl,
  ));
}
