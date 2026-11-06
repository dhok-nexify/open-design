/**
 * Short-lived cache of a member's effective rights on one NexTore project
 * (NXD-D07, DESIGN §15.4).
 *
 * Every project request would otherwise cost a module round trip. The TTL is
 * the documented 45 seconds: long enough to keep a chat turn cheap, short
 * enough that a revoked permission stops working without a restart.
 */
export interface NextoreProjectAccess {
  exists: boolean;
  canRead: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canManage: boolean;
  canDownload: boolean;
}

export interface ProjectAccessCache {
  read(
    key: string,
    load: () => Promise<NextoreProjectAccess>,
  ): Promise<NextoreProjectAccess>;
  invalidatePrefix(prefix: string): void;
  clear(): void;
  size(): number;
}

export interface ProjectAccessCacheOptions {
  ttlMs?: number;
  now?: () => number;
}

const DEFAULT_TTL_MS = 45_000;

export function createProjectAccessCache(
  options: ProjectAccessCacheOptions = {},
): ProjectAccessCache {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const now = options.now ?? Date.now;
  const values = new Map<string, { at: number; value: NextoreProjectAccess }>();
  const inflight = new Map<string, Promise<NextoreProjectAccess>>();

  return {
    async read(key, load) {
      const cached = values.get(key);
      if (cached && now() - cached.at < ttlMs) return cached.value;

      const pending = inflight.get(key);
      if (pending) return pending;

      const promise = load()
        .then((value) => {
          values.set(key, { at: now(), value });
          return value;
        })
        .finally(() => {
          inflight.delete(key);
        });
      inflight.set(key, promise);
      return promise;
    },

    invalidatePrefix(prefix) {
      for (const key of [...values.keys()]) {
        if (key.startsWith(prefix)) values.delete(key);
      }
    },

    clear() {
      values.clear();
      inflight.clear();
    },

    size() {
      return values.size;
    },
  };
}
