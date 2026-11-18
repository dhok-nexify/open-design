import { createHmac } from 'node:crypto';
import Database from 'better-sqlite3';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  acceptEvent,
  dispatchEvent,
  verifyEvent,
} from '../src/nextore/events/inbound.js';
import { registerNextoreEventRoutes } from '../src/nextore/events/routes.js';

const SECRET = 'test-secret';
let db: Database.Database;
let server: Server | null = null;

beforeEach(() => {
  db = new Database(':memory:');
});

afterEach(async () => {
  if (server) {
    const current = server;
    server = null;
    await new Promise<void>((resolve) => current.close(() => resolve()));
  }
  db.close();
});

function sign(raw: Buffer, timestamp: string, secret = SECRET): string {
  return 'v1=' + createHmac('sha256', secret).update(timestamp, 'utf8').update('.').update(raw).digest('hex');
}

const event = { id: 'evt-1', type: 'permission.changed', at: 1, projectId: 'p1', sequence: 1 };
const raw = Buffer.from(JSON.stringify(event), 'utf8');

describe('P03 verifyEvent', () => {
  it('accepts a signature over the raw bytes', () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const result = verifyEvent({
      rawBody: raw,
      eventId: 'evt-1',
      timestamp: ts,
      signature: sign(raw, ts),
      contentType: 'application/json',
      secrets: [SECRET],
    });
    expect(result.ok).toBe(true);
    expect(result.event).toMatchObject({ id: 'evt-1', projectId: 'p1' });
  });

  it('rejects a body that was re-serialised after signing', () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const reserialised = Buffer.from(JSON.stringify(event, null, 2), 'utf8');
    const result = verifyEvent({
      rawBody: reserialised,
      eventId: 'evt-1',
      timestamp: ts,
      signature: sign(raw, ts),
      contentType: 'application/json',
      secrets: [SECRET],
    });
    expect(result.reason).toBe('bad_signature');
  });

  it('rejects a stale timestamp', () => {
    const ts = String(Math.floor(Date.now() / 1000) - 301);
    const result = verifyEvent({
      rawBody: raw,
      eventId: 'evt-1',
      timestamp: ts,
      signature: sign(raw, ts),
      contentType: 'application/json',
      secrets: [SECRET],
    });
    expect(result.reason).toBe('timestamp_skew');
  });

  it('accepts the previous secret during rotation', () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const result = verifyEvent({
      rawBody: raw,
      eventId: 'evt-1',
      timestamp: ts,
      signature: sign(raw, ts, 'old-secret'),
      contentType: 'application/json',
      secrets: [SECRET, 'old-secret'],
    });
    expect(result.ok).toBe(true);
  });

  it('rejects a non-JSON content type', () => {
    const result = verifyEvent({
      rawBody: raw,
      eventId: 'evt-1',
      timestamp: '1',
      signature: 'v1=00',
      contentType: 'text/plain',
      secrets: [SECRET],
    });
    expect(result.reason).toBe('invalid_content_type');
  });
});

describe('P03 acceptEvent', () => {
  it('accepts once and reports a replay afterwards', () => {
    expect(acceptEvent(db, { ...event }, 1_000).accepted).toBe(true);
    expect(acceptEvent(db, { ...event }, 1_001)).toMatchObject({ accepted: false, reason: 'replayed' });
  });

  it('drops a stale sequence and accepts a newer one', () => {
    acceptEvent(db, { ...event, id: 'evt-1', sequence: 5 }, 1_000);
    expect(acceptEvent(db, { ...event, id: 'evt-2', sequence: 5 }, 1_001))
      .toMatchObject({ accepted: false, reason: 'stale_sequence' });
    expect(acceptEvent(db, { ...event, id: 'evt-3', sequence: 6 }, 1_002).accepted).toBe(true);
  });

  it('tracks sequences per project, not globally', () => {
    acceptEvent(db, { ...event, id: 'evt-1', projectId: 'p1', sequence: 9 }, 1_000);
    expect(acceptEvent(db, { ...event, id: 'evt-2', projectId: 'p2', sequence: 1 }, 1_001).accepted)
      .toBe(true);
  });
});

describe('P03 dispatchEvent', () => {
  it('routes each type to its hook and ignores unknown types', () => {
    const hooks = {
      onPermissionChanged: vi.fn(),
      onProjectGone: vi.fn(),
      onMemberDisabled: vi.fn(),
    };
    dispatchEvent({ ...event, type: 'permission.changed', projectId: 'p1' } as never, hooks);
    dispatchEvent({ ...event, type: 'project.deleted', projectId: 'p2' } as never, hooks);
    dispatchEvent({ ...event, type: 'member.locked', memberId: 7 } as never, hooks);

    expect(hooks.onPermissionChanged).toHaveBeenCalledWith('p1');
    expect(hooks.onProjectGone).toHaveBeenCalledWith('p2');
    expect(hooks.onMemberDisabled).toHaveBeenCalledWith(7);
    expect(dispatchEvent({ ...event, type: 'unknown' } as never, hooks)).toBe(false);
  });
});

describe('P03 event route', () => {
  async function start(): Promise<string> {
    const app = express();
    const hooks = {
      onPermissionChanged: vi.fn(),
      onProjectGone: vi.fn(),
      onMemberDisabled: vi.fn(),
    };
    registerNextoreEventRoutes(app, {
      db: () => db,
      secrets: () => [SECRET],
      hooks,
      consumerId: 'test-daemon',
    });
    server = createServer(app);
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', () => resolve()));
    const { port } = server.address() as AddressInfo;
    return 'http://127.0.0.1:' + port;
  }

  function post(base: string, body: Buffer, ts: string, signature: string) {
    return fetch(base + '/api/nextore/events', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-nxd-event-id': 'evt-1',
        'x-nxd-timestamp': ts,
        'x-nxd-signature': signature,
      },
      body,
    });
  }

  it('accepts a signed event and rejects the replay', async () => {
    const base = await start();
    const ts = String(Math.floor(Date.now() / 1000));

    const first = await post(base, raw, ts, sign(raw, ts));
    expect(first.status).toBe(202);
    expect(await first.json()).toMatchObject({ accepted: true });

    const second = await post(base, raw, ts, sign(raw, ts));
    expect(second.status).toBe(202);
    expect(await second.json()).toMatchObject({ accepted: false, reason: 'replayed' });
  });

  it('rejects a tampered body', async () => {
    const base = await start();
    const ts = String(Math.floor(Date.now() / 1000));
    const tampered = Buffer.from(JSON.stringify({ ...event, projectId: 'p9' }), 'utf8');

    const response = await post(base, tampered, ts, sign(raw, ts));

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: 'bad_signature' });
  });

  it('reports the single-active-daemon consumer identity', async () => {
    const base = await start();

    const response = await fetch(base + '/api/nextore/events/consumer');

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ consumerId: 'test-daemon', singleActiveDaemon: true });
  });
});
