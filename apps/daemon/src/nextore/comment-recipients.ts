/**
 * P05 recipient resolution from the project permission matrix.
 *
 * The UI permission drawer already exposes per-member rights through
 * `projectPermissions`; that matrix is an ACL view, unlike the directory search
 * (`permission-members`), which is a contact lookup and cannot answer
 * "who can manage this project".
 */

export interface ProjectPermissionsClient {
  projectPermissions<T>(accessToken: string, projectId: string): Promise<T>;
}

export interface RecipientCacheEntry {
  memberIds: number[];
  at: number;
}

export interface RecipientCache {
  get(key: string): RecipientCacheEntry | undefined;
  set(key: string, value: RecipientCacheEntry): void;
}

export function createRecipientCache(ttlMs = 60_000, now: () => number = Date.now): RecipientCache & { ttlMs: number; now: () => number } {
  const values = new Map<string, RecipientCacheEntry>();
  return {
    ttlMs,
    now,
    get(key) {
      const entry = values.get(key);
      if (!entry) return undefined;
      if (now() - entry.at >= ttlMs) {
        values.delete(key);
        return undefined;
      }
      return entry;
    },
    set(key, value) {
      values.set(key, value);
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function readBoolean(row: Record<string, unknown>, keys: string[]): boolean {
  for (const key of keys) {
    const raw = row[key];
    if (raw === true || raw === 1 || raw === '1' || raw === 'true') return true;
  }
  return false;
}

function readId(row: Record<string, unknown>): number | null {
  for (const key of ['RecordId', 'recordId', 'memberId', 'MemberId', 'id', 'Id', 'memberID']) {
    const raw = row[key];
    if (typeof raw === 'number' && Number.isInteger(raw) && raw > 0) return raw;
    if (typeof raw === 'string' && /^\d+$/.test(raw)) return Number(raw);
  }
  return null;
}

/** Read a manage flag that may sit on the row or under a Rights object. */
function readManage(row: Record<string, unknown>): boolean {
  if (readBoolean(row, ['manage', 'Manage', 'canManage', 'CanManage', 'canManageProject', 'CanManageProject'])) return true;
  const rights = asRecord(row.Rights) ?? asRecord(row.rights);
  return rights ? readBoolean(rights, ['manage', 'Manage']) : false;
}

/** Pull every member row out of the permission payload (array or wrapped). */
export function extractManageMemberIds(payload: unknown): number[] {
  const root = asRecord(payload);
  const arrays = [
    'members', 'permissions', 'memberPermissions', 'Customized', 'customized', 'Inherited', 'inherited',
  ];
  const candidates = Array.isArray(payload)
    ? payload
    : arrays.flatMap((key) => {
      const value = root?.[key];
      return Array.isArray(value) ? value as unknown[] : [];
    });
  const result = new Set<number>();
  for (const entry of candidates) {
    const row = asRecord(entry);
    if (!row) continue;
    // Group rows carry a group id; recipients must be member ids.
    const type = row.RecordType ?? row.recordType;
    if (typeof type === 'string' && type.toLowerCase() !== 'member') continue;
    if (!readManage(row)) continue;
    const id = readId(row);
    if (id !== null) result.add(id);
  }
  return [...result];
}

export interface ResolveManageRecipientsInput {
  client: ProjectPermissionsClient;
  accessToken: string;
  nextoreProjectId: string;
  ownerMemberId: number | null;
  cache?: RecipientCache;
  now?: () => number;
}

export interface ResolveManageRecipientsResult {
  memberIds: number[];
  /** True when the matrix could not be read and only the owner is returned. */
  degraded: boolean;
}

const ownerOnly = (ownerMemberId: number | null, degraded: boolean): ResolveManageRecipientsResult => ({
  memberIds: typeof ownerMemberId === 'number' && ownerMemberId > 0 ? [ownerMemberId] : [],
  degraded,
});

/**
 * Owner + every member whose permission row grants manage.
 *
 * Never throws and never blocks the caller: an unreadable matrix degrades to
 * the owner so a comment still notifies somebody useful.
 */
export async function resolveProjectManageRecipients(
  input: ResolveManageRecipientsInput,
): Promise<ResolveManageRecipientsResult> {
  const cache = input.cache;
  if (cache) {
    const hit = cache.get(input.nextoreProjectId);
    if (hit) return { memberIds: hit.memberIds, degraded: false };
  }

  try {
    const payload = await input.client.projectPermissions<unknown>(input.accessToken, input.nextoreProjectId);
    const ids = new Set(extractManageMemberIds(payload));
    if (typeof input.ownerMemberId === 'number' && input.ownerMemberId > 0) ids.add(input.ownerMemberId);
    const memberIds = [...ids];
    cache?.set(input.nextoreProjectId, { memberIds, at: (input.now ?? Date.now)() });
    return { memberIds, degraded: false };
  } catch {
    return ownerOnly(input.ownerMemberId, true);
  }
}
