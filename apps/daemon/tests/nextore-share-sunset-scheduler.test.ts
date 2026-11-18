import { describe, expect, it, vi } from 'vitest';

import { createShareSunsetScheduler } from '../src/nextore/share/sunset-scheduler.js';

const DAY = 24 * 60 * 60 * 1000;

describe('P04h sunset scheduler', () => {
  it('does not schedule anything when the switch is off', () => {
    const setTimer = vi.fn();
    const scheduler = createShareSunsetScheduler({
      enabled: false,
      runSweep: vi.fn(),
      setTimer,
    });

    expect(scheduler.start()).toBe(false);
    expect(setTimer).not.toHaveBeenCalled();
  });

  it('schedules the first tick at the next UTC midnight', () => {
    const setTimer = vi.fn();
    const scheduler = createShareSunsetScheduler({
      enabled: true,
      runSweep: vi.fn(),
      now: () => Date.UTC(2026, 0, 1, 12, 0, 0),
      setTimer,
    });

    expect(scheduler.start()).toBe(true);
    expect(setTimer).toHaveBeenCalledTimes(1);
    expect(setTimer.mock.calls[0]![1]).toBe(12 * 60 * 60 * 1000);
  });

  it('runs the sweep on each tick and reschedules', async () => {
    const runSweep = vi.fn(async () => {});
    const callbacks: Array<() => void> = [];
    const setTimer = vi.fn((fn: () => void) => {
      callbacks.push(fn);
      return callbacks.length;
    });
    const scheduler = createShareSunsetScheduler({
      enabled: true,
      runSweep,
      now: () => Date.UTC(2026, 0, 1, 0, 0, 0),
      setTimer,
      clearTimer: vi.fn(),
    });

    scheduler.start();
    callbacks[0]!();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(runSweep).toHaveBeenCalledTimes(1);
    expect(setTimer).toHaveBeenCalledTimes(2);
  });

  it('stops a scheduled tick', () => {
    const clearTimer = vi.fn();
    const scheduler = createShareSunsetScheduler({
      enabled: true,
      runSweep: vi.fn(),
      setTimer: () => 42,
      clearTimer,
    });

    scheduler.start();
    scheduler.stop();

    expect(clearTimer).toHaveBeenCalledWith(42);
  });
});
