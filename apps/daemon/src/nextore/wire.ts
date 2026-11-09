import type { NextoreBrandingResponse } from '@open-design/contracts';

import type { NextoreProjectAccess } from './acl/access-cache.js';

/**
 * NexTore's module serializes its models with PascalCase names in the live
 * deployment, while the daemon's contracts and tests use camelCase. Keep the
 * compatibility lane in one place so every module boundary handles both wire
 * shapes instead of each caller guessing.
 */
export type WireObject = Record<string, unknown>;

export function wireObject(value: unknown): WireObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as WireObject)
    : null;
}

export function wireArray(value: unknown, camel: string, pascal: string): unknown[] {
  const object = wireObject(value);
  const list = object?.[camel] ?? object?.[pascal];
  return Array.isArray(list) ? list : [];
}

export function wireString(
  value: unknown,
  camel: string,
  pascal: string,
): string | undefined {
  const object = wireObject(value);
  const field = object?.[camel] ?? object?.[pascal];
  return typeof field === 'string' ? field : undefined;
}

export function wireNumber(
  value: unknown,
  camel: string,
  pascal: string,
): number | undefined {
  const object = wireObject(value);
  const field = object?.[camel] ?? object?.[pascal];
  return typeof field === 'number' && Number.isFinite(field) ? field : undefined;
}

export function wireBoolean(
  value: unknown,
  camel: string,
  pascal: string,
): boolean | undefined {
  const object = wireObject(value);
  const field = object?.[camel] ?? object?.[pascal];
  return typeof field === 'boolean' ? field : undefined;
}

function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * The module normally sends a settings version. Hash the payload when an older
 * module omits it so the public ETag still changes when branding changes.
 */
export function brandingVersion(value: unknown, explicit?: number): number {
  if (typeof explicit === 'number' && Number.isFinite(explicit) && explicit !== 0) {
    return explicit;
  }
  try {
    return fnv1a(JSON.stringify(value ?? null));
  } catch {
    return 0;
  }
}

export function normalizeBranding(value: unknown): NextoreBrandingResponse {
  const logoLight = wireString(value, 'logoLight', 'LogoLight');
  const logoDark = wireString(value, 'logoDark', 'LogoDark');
  const favicon = wireString(value, 'favicon', 'Favicon');
  const loadingText = wireString(value, 'loadingText', 'LoadingText');
  return {
    siteTitle: wireString(value, 'siteTitle', 'SiteTitle')?.trim() ?? '',
    brandName: wireString(value, 'brandName', 'BrandName')?.trim() ?? '',
    ...(logoLight === undefined ? {} : { logoLight }),
    ...(logoDark === undefined ? {} : { logoDark }),
    ...(favicon === undefined ? {} : { favicon }),
    primaryColor: wireString(value, 'primaryColor', 'PrimaryColor')?.trim() ?? '',
    ...(loadingText === undefined ? {} : { loadingText }),
    version: brandingVersion(value, wireNumber(value, 'version', 'Version')),
  };
}

export function normalizeAccess(value: unknown): NextoreProjectAccess {
  return {
    exists: wireBoolean(value, 'exists', 'Exists') ?? false,
    canRead: wireBoolean(value, 'canRead', 'CanRead') ?? false,
    canEdit: wireBoolean(value, 'canEdit', 'CanEdit') ?? false,
    canDelete: wireBoolean(value, 'canDelete', 'CanDelete') ?? false,
    canManage: wireBoolean(value, 'canManage', 'CanManage') ?? false,
    canDownload: wireBoolean(value, 'canDownload', 'CanDownload') ?? false,
  };
}

export interface NextoreMemberSummary {
  id: number;
  login?: string;
  fullName?: string;
  email?: string;
}

export function normalizeMember(value: unknown): NextoreMemberSummary | null {
  const id = wireNumber(value, 'id', 'Id');
  if (id === null || id === undefined || id <= 0) return null;
  const login = wireString(value, 'login', 'Login')?.trim();
  const fullName = wireString(value, 'fullName', 'FullName')?.trim();
  const email = wireString(value, 'email', 'Email')?.trim();
  return {
    id,
    ...(login ? { login } : {}),
    ...(fullName ? { fullName } : {}),
    ...(email ? { email } : {}),
  };
}

export function normalizePermissionUrl(value: unknown): string | null {
  const url = wireString(value, 'url', 'Url')?.trim();
  return url || null;
}
