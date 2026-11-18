/**
 * NXD-P09: optional same-origin sub-path (e.g. `/designer`).
 *
 * Empty/undefined means "root deployment" and must leave every URL untouched.
 */
export function resolveBasePath(value: string | undefined | null): string {
  return (value ?? '').trim().replace(/\/+$/, '');
}

/** Prefix an app-absolute path; a root deployment returns it unchanged. */
export function withBasePath(basePath: string, path: string): string {
  if (!basePath) return path;
  return basePath + (path.startsWith('/') ? path : '/' + path);
}
