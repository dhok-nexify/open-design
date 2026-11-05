import type { Edition } from '@open-design/contracts';

export interface NextoreConfig {
  baseUrl: string;
  oauthClientId: string;
  designerBaseUrl: string;
  secretFile: string;
  trustProxy: string | null;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required when OD_EDITION=nextore.`);
  return value;
}

function normalizeHttpUrl(name: string, value: string, requireOrigin = false): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute http(s) URL.`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${name} must use http or https.`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`${name} must not contain embedded credentials.`);
  }
  if (parsed.search || parsed.hash) {
    throw new Error(`${name} must not contain a query string or fragment.`);
  }
  if (requireOrigin && parsed.pathname !== '/' && parsed.pathname !== '') {
    throw new Error(`${name} must point to an origin without a path.`);
  }

  const pathname = parsed.pathname.replace(/\/+$/, '');
  return `${parsed.origin}${pathname}`;
}

/**
 * Read and validate the NexTore edition configuration at process startup.
 * Upstream does not require any NexTore settings, so it returns null.
 */
export function readNextoreConfig(
  env: NodeJS.ProcessEnv = process.env,
  edition: Edition,
): NextoreConfig | null {
  if (edition !== 'nextore') return null;

  return {
    baseUrl: normalizeHttpUrl('NEXTORE_BASE_URL', required(env, 'NEXTORE_BASE_URL'), true),
    oauthClientId: required(env, 'NEXTORE_OAUTH_CLIENT_ID'),
    designerBaseUrl: normalizeHttpUrl(
      'DESIGNER_BASE_URL',
      required(env, 'DESIGNER_BASE_URL'),
      true,
    ),
    secretFile: required(env, 'DESIGNER_SECRET_FILE'),
    trustProxy: env.TRUST_PROXY?.trim() || null,
  };
}
