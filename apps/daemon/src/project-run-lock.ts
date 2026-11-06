export interface ProjectRunLockHolder {
  runId: string;
  memberId: number | null;
  acquiredAt: number;
}

export type ProjectRunLockResult =
  | { ok: true }
  | { ok: false; holder: ProjectRunLockHolder };

export interface ProjectRunLock {
  tryAcquire(
    projectId: string,
    holder: { runId: string; memberId: number | null },
    isRunActive: (runId: string) => boolean,
  ): ProjectRunLockResult;
  holder(projectId: string): ProjectRunLockHolder | null;
  release(projectId: string, runId: string): void;
  clear(): void;
  size(): number;
}

export interface ProjectRunLockOptions {
  /** Safety net for a holder whose run record vanished before it went terminal. */
  ttlMs?: number;
  now?: () => number;
}

const DEFAULT_TTL_MS = 30 * 60_000;

/**
 * One active run per project in the NexTore edition (NXD-D11).
 *
 * Two members generating into the same project directory overwrite each
 * other's files: the run lock is what turns that into a clear "someone else is
 * working here" answer instead of silent corruption.
 *
 * The lock is self-healing rather than release-driven: a holder stops blocking
 * as soon as its run is missing or terminal, and a holder older than the TTL is
 * ignored even if its run record never settles. That way a crashed daemon, a
 * killed process, or a missed release can never wedge a project.
 */
export function createProjectRunLock(options: ProjectRunLockOptions = {}): ProjectRunLock {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const now = options.now ?? Date.now;
  const held = new Map<string, ProjectRunLockHolder>();

  const isStale = (holder: ProjectRunLockHolder): boolean => {
    if (now() - holder.acquiredAt > ttlMs) return true;
    return false;
  };

  return {
    tryAcquire(projectId, holder, isRunActive) {
      const existing = held.get(projectId);
      if (existing) {
        const sameRun = existing.runId === holder.runId;
        const active = !isStale(existing) && isRunActive(existing.runId);
        if (active && !sameRun) return { ok: false, holder: existing };
        if (active && sameRun) return { ok: true };
      }
      held.set(projectId, {
        runId: holder.runId,
        memberId: holder.memberId,
        acquiredAt: now(),
      });
      return { ok: true };
    },

    holder(projectId) {
      return held.get(projectId) ?? null;
    },

    release(projectId, runId) {
      const existing = held.get(projectId);
      if (existing && existing.runId === runId) held.delete(projectId);
    },

    clear() {
      held.clear();
    },

    size() {
      return held.size;
    },
  };
}
