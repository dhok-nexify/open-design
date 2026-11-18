/**
 * Server-sent events for one NexTore session (2026-11-18).
 *
 * A sign-out at the site can only be observed by asking the module whether the
 * OAuth connection still exists. Every open tab used to ask that question on a
 * timer of its own, which multiplied the module load and the database writes by
 * the number of tabs. This registry lets the daemon own the question: tabs
 * subscribe once, the watchdog validates a subscribed session on a single
 * timer, and a revocation is written to every subscriber as one event.
 */
import type { Response } from 'express';

const subscribers = new Map<string, Set<Response>>();

/** Registers one open stream for `sid`; the returned function unregisters it. */
export function subscribeSessionEvents(sid: string, res: Response): () => void {
  let set = subscribers.get(sid);
  if (!set) {
    set = new Set<Response>();
    subscribers.set(sid, set);
  }
  set.add(res);
  return () => {
    const current = subscribers.get(sid);
    if (!current) return;
    current.delete(res);
    if (current.size === 0) subscribers.delete(sid);
  };
}

/** Session ids with at least one open stream — the only ones worth watching. */
export function subscribedSessionIds(): string[] {
  return [...subscribers.keys()];
}

/**
 * Tells every tab on this session that the daemon ended it, then closes the
 * streams: the browser must run OAuth again, not listen to a dead session.
 */
export function publishSessionRevoked(sid: string): void {
  const set = subscribers.get(sid);
  if (!set) return;
  subscribers.delete(sid);
  const payload = 'event: session\ndata: {"state":"revoked"}\n\n';
  for (const res of set) {
    try {
      if (!res.writableEnded && !res.destroyed) {
        res.write(payload);
        res.end();
      }
    } catch {
      // One dead socket must not stop the other tabs from being told.
    }
  }
}

/** Test helper: drop every subscription. */
export function resetSessionEventsForTests(): void {
  subscribers.clear();
}
