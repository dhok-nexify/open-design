/**
 * Effective rights on one project, as the daemon reports them (NXD-D10).
 *
 * The edition's ACL lives in NexTore, so the project detail surface asks the
 * daemon once per open instead of guessing from local state. `mapped: false`
 * means the project has no NexTore record yet and the local defaults apply.
 */
export interface NextoreProjectAccessView {
  mapped: boolean;
  exists: boolean;
  canRead: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canManage: boolean;
  canDownload: boolean;
  /** Module ShareLinksEnabled; absent means enabled. */
  shareLinksEnabled?: boolean;
  /** True when access came from a redeemed share link (NXD-D20). */
  viaShareLink?: boolean;
}

export const LOCAL_PROJECT_ACCESS: NextoreProjectAccessView = {
  mapped: false,
  exists: true,
  canRead: true,
  canEdit: true,
  canDelete: true,
  canManage: true,
  canDownload: true,
  shareLinksEnabled: true,
};

function normalize(value: unknown): NextoreProjectAccessView {
  const source = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const flag = (key: keyof NextoreProjectAccessView): boolean =>
    typeof source[key] === 'boolean' ? (source[key] as boolean) : true;
  return {
    mapped: source.mapped === true,
    exists: flag('exists'),
    canRead: flag('canRead'),
    canEdit: flag('canEdit'),
    canDelete: flag('canDelete'),
    canManage: flag('canManage'),
    canDownload: flag('canDownload'),
    shareLinksEnabled: source.shareLinksEnabled !== false,
    viaShareLink: source.viaShareLink === true,
  };
}

/**
 * Reads the effective rights for a project. Returns null when the request
 * failed, so callers keep the local (writable) default instead of locking a
 * project because of a transient network error.
 */
export async function fetchNextoreProjectAccess(
  projectId: string,
  options: { signal?: AbortSignal; fetchImpl?: typeof fetch } = {},
): Promise<NextoreProjectAccessView | null> {
  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(
      '/api/projects/' + encodeURIComponent(projectId) + '/nextore-access',
      {
        headers: { accept: 'application/json' },
        ...(options.signal ? { signal: options.signal } : {}),
      },
    );
    if (!response.ok) return null;
    return normalize(await response.json());
  } catch {
    return null;
  }
}
