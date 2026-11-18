/**
 * P04h daily sunset-notice scheduler.
 *
 * Runs once per UTC day, aligned to 00:00, and only when the env switch is on.
 * Kept dependency-injected so tests can drive ticks without real timers.
 */
export interface ShareSunsetSchedulerDeps {
  enabled: boolean;
  runSweep: () => Promise<void>;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface ShareSunsetScheduler {
  start(): boolean;
  stop(): void;
  /** Milliseconds until the next UTC midnight. */
  delayUntilNextTick(): number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function createShareSunsetScheduler(deps: ShareSunsetSchedulerDeps): ShareSunsetScheduler {
  const now = deps.now ?? Date.now;
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((handle) => clearTimeout(handle as NodeJS.Timeout));
  let timer: unknown = null;

  const delayUntilNextTick = (): number => {
    const t = now();
    const nextMidnight = Math.ceil(t / DAY_MS) * DAY_MS;
    return Math.max(1_000, nextMidnight - t);
  };

  const schedule = () => {
    timer = setTimer(() => {
      timer = null;
      void deps.runSweep()
        .catch(() => {
          // A failed sweep must not kill the schedule; the next tick retries.
        })
        .finally(() => {
          if (deps.enabled) schedule();
        });
    }, delayUntilNextTick());
  };

  return {
    start() {
      if (!deps.enabled || timer !== null) return false;
      schedule();
      return true;
    },
    stop() {
      if (timer === null) return;
      clearTimer(timer);
      timer = null;
    },
    delayUntilNextTick,
  };
}
