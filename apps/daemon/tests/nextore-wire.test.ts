import { describe, expect, it } from 'vitest';

import {
  normalizeAccess,
  normalizeBranding,
  normalizeMember,
  normalizePermissionUrl,
  wireArray,
} from '../src/nextore/wire.js';

describe('NexTore wire normalization', () => {
  it('reads the live PascalCase workspace envelope', () => {
    const payload = {
      Workspaces: [{ Id: 286041, Name: 'admin Workspace', Type: 'personal' }],
    };
    expect(wireArray(payload, 'workspaces', 'Workspaces')).toEqual(payload.Workspaces);
  });

  it('normalizes PascalCase branding and keeps the module version', () => {
    expect(normalizeBranding({
      SiteTitle: 'NexTore Designer',
      BrandName: 'NexTore Designer',
      PrimaryColor: '#4F46E5',
      Version: 5309426729634911000,
    })).toEqual({
      siteTitle: 'NexTore Designer',
      brandName: 'NexTore Designer',
      primaryColor: '#4F46E5',
      version: 5309426729634911000,
    });
  });

  it('derives a stable version when an older module omits it', () => {
    const first = normalizeBranding({ SiteTitle: 'A', PrimaryColor: '#111111' });
    const second = normalizeBranding({ SiteTitle: 'A', PrimaryColor: '#111111' });
    const changed = normalizeBranding({ SiteTitle: 'B', PrimaryColor: '#111111' });
    expect(first.version).toBe(second.version);
    expect(changed.version).not.toBe(first.version);
  });

  it('normalizes PascalCase project access flags', () => {
    expect(normalizeAccess({
      Exists: true,
      CanRead: true,
      CanEdit: false,
      CanDelete: false,
      CanManage: false,
      CanDownload: true,
    })).toEqual({
      exists: true,
      canRead: true,
      canEdit: false,
      canDelete: false,
      canManage: false,
      canDownload: true,
    });
  });

  it('normalizes member rows and drops rows without a usable id', () => {
    expect(normalizeMember({
      Id: 1,
      Login: 'admin',
      FullName: 'AdminUser',
      Email: 'admin@example.test',
    })).toEqual({
      id: 1,
      login: 'admin',
      fullName: 'AdminUser',
      email: 'admin@example.test',
    });
    expect(normalizeMember({ Id: 0 })).toBeNull();
    expect(normalizeMember({})).toBeNull();
  });

  it('accepts the module permission URL casing', () => {
    expect(normalizePermissionUrl({ Url: 'https://nextore.example/permissions/1' }))
      .toBe('https://nextore.example/permissions/1');
    expect(normalizePermissionUrl({})).toBeNull();
  });
});
