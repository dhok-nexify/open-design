import { describe, expect, it } from 'vitest';
import { readNextoreConfig } from '../src/nextore/config.js';

const baseEnv = {
  NEXTORE_BASE_URL: 'http://10.0.0.4:5065/',
  NEXTORE_OAUTH_CLIENT_ID: 'designer-client',
  DESIGNER_BASE_URL: 'https://designer.example.com/',
  DESIGNER_SECRET_FILE: '/run/secrets/designer',
} satisfies NodeJS.ProcessEnv;

describe('readNextoreConfig', () => {
  it('does not require NexTore settings in the upstream edition', () => {
    expect(readNextoreConfig({}, 'upstream')).toBeNull();
  });

  it('normalizes validated NexTore edition settings', () => {
    expect(readNextoreConfig(baseEnv, 'nextore')).toEqual({
      baseUrl: 'http://10.0.0.4:5065',
      oauthClientId: 'designer-client',
      designerBaseUrl: 'https://designer.example.com',
      secretFile: '/run/secrets/designer',
      trustProxy: null,
    });
  });

  it('fails fast when a required setting is missing', () => {
    expect(() => readNextoreConfig({ ...baseEnv, NEXTORE_BASE_URL: ' ' }, 'nextore'))
      .toThrow('NEXTORE_BASE_URL is required when OD_EDITION=nextore.');
  });

  it('rejects unsafe or malformed base URLs', () => {
    expect(() => readNextoreConfig({ ...baseEnv, NEXTORE_BASE_URL: 'file:///tmp/nextore' }, 'nextore'))
      .toThrow('NEXTORE_BASE_URL must use http or https.');
    expect(() => readNextoreConfig({ ...baseEnv, NEXTORE_BASE_URL: 'http://user:pass@nextore' }, 'nextore'))
      .toThrow('NEXTORE_BASE_URL must not contain embedded credentials.');
    expect(() => readNextoreConfig({ ...baseEnv, DESIGNER_BASE_URL: 'https://example.com/path' }, 'nextore'))
      .toThrow('DESIGNER_BASE_URL must point to an origin without a path.');
  });
});
