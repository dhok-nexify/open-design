import type { Edition } from '@open-design/contracts';

/** Whether a run's project mutation must pass the project authorizer. */
export function requiresRunProjectAuthorization(input: {
  edition: Edition;
  hasBinding: boolean;
  visibility?: string | null;
  hasRequestContext: boolean;
}): boolean {
  if (input.edition === 'nextore') return true;
  if (!input.hasBinding) return false;
  return input.visibility === 'team' || input.hasRequestContext;
}

/**
 * Resolve a module permission URL against NexTore without allowing the module
 * response to redirect the browser to another origin.
 */
export function resolveNextorePermissionUrl(
  permissionUrl: string,
  nextoreBaseUrl: string,
): string | null {
  try {
    const expected = new URL(nextoreBaseUrl);
    const resolved = new URL(permissionUrl, nextoreBaseUrl);
    return resolved.origin === expected.origin ? resolved.toString() : null;
  } catch {
    return null;
  }
}
