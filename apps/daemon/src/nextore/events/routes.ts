import express, { type Express } from 'express';
import type Database from 'better-sqlite3';

import { acceptEvent, dispatchEvent, verifyEvent, type EventHooks } from './inbound.js';

type SqliteDb = Database.Database;

export interface RegisterNextoreEventRoutesDeps {
  db: () => SqliteDb;
  /** Current + previous secret, so rotation never drops a delivery. */
  secrets: () => string[];
  hooks: EventHooks;
  consumerId: string;
  now?: () => number;
  log?: { info: (msg: string) => void; warn: (msg: string) => void };
}

/**
 * NXD-P03 inbound event push.
 *
 * The raw parser is mounted BEFORE the global JSON parser: the signature covers
 * the bytes as received, so parsing first and re-stringifying would break it.
 */
export function registerNextoreEventRoutes(app: Express, deps: RegisterNextoreEventRoutesDeps): void {
  const now = deps.now ?? Date.now;

  app.post(
    '/api/nextore/events',
    express.raw({ type: 'application/json', limit: '1mb' }),
    (req, res) => {
      const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      const verified = verifyEvent({
        rawBody: raw,
        eventId: req.get('x-nxd-event-id'),
        timestamp: req.get('x-nxd-timestamp'),
        signature: req.get('x-nxd-signature'),
        contentType: req.get('content-type'),
        secrets: deps.secrets(),
        now,
      });
      if (!verified.ok) {
        deps.log?.warn('[nextore-events] rejected: ' + verified.reason);
        res.status(verified.reason === 'invalid_content_type' ? 415 : 401)
          .json({ error: verified.reason ?? 'invalid_event' });
        return;
      }
      const accepted = acceptEvent(deps.db(), verified.event!, now());
      if (!accepted.accepted) {
        // Replays and stale sequences are acknowledged so the module stops
        // retrying a delivery that can never become useful.
        res.status(202).json({ accepted: false, reason: accepted.reason });
        return;
      }
      const handled = dispatchEvent(verified.event!, deps.hooks);
      if (!handled) deps.log?.info('[nextore-events] ignored type ' + verified.event!.type);
      res.status(202).json({ accepted: true, handled });
    },
  );

  app.get('/api/nextore/events/consumer', (_req, res) => {
    res.json({
      consumerId: deps.consumerId,
      singleActiveDaemon: true,
      maxSkewSeconds: 300,
      dedupeMs: 600000,
    });
  });
}
