import { createServer as createNetServer, connect, type AddressInfo, type Server } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { buildBwrapArgs } from '../src/sandbox/bwrap-provider.js';
import { createEgressBridge } from '../src/sandbox/egress-bridge.js';
import { createEgressRelay, parseRelayArgs } from '../src/sandbox/egress-relay.js';

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

function echoServer(): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createNetServer((socket) => socket.pipe(socket));
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: (server.address() as AddressInfo).port });
    });
  });
}

function roundTrip(port: number, payload: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1');
    let received = '';
    socket.on('connect', () => socket.write(payload));
    socket.on('data', (chunk) => {
      received += chunk.toString('utf8');
      if (received.length >= payload.length) {
        socket.destroy();
        resolve(received);
      }
    });
    socket.on('error', reject);
  });
}

describe('sandbox egress relay (P01)', () => {
  it('builds unshare-net args with the relay in front of the agent', () => {
    const args = buildBwrapArgs(
      { command: '/usr/bin/agent', args: ['--model', 'x'], cwd: '/work', env: {} },
      { socketPath: '/data/sandbox/egress.sock', port: 8888, relayScript: '/app/egress-relay.js', nodeBin: '/usr/bin/node' },
    );

    expect(args).toContain('--unshare-net');
    expect(args).not.toContain('--share-net');
    const relayAt = args.indexOf('/app/egress-relay.js');
    expect(relayAt).toBeGreaterThan(-1);
    expect(args.slice(relayAt, relayAt + 6)).toEqual([
      '/app/egress-relay.js', '--listen', '8888', '--socket', '/data/sandbox/egress.sock', '--',
    ]);
    expect(args.slice(-3)).toEqual(['/usr/bin/agent', '--model', 'x']);
  });

  it('keeps the shared network when no egress options are given', () => {
    const args = buildBwrapArgs({ command: 'agent', args: [], cwd: '/work', env: {} });
    expect(args).toContain('--share-net');
    expect(args).not.toContain('--unshare-net');
  });

  it('parses the relay argv', () => {
    expect(parseRelayArgs(['--listen', '8888', '--socket', '/s', '--', 'agent', '--flag'])).toEqual({
      listenPort: 8888,
      socketPath: '/s',
      command: 'agent',
      args: ['--flag'],
    });
    expect(parseRelayArgs(['--listen', 'x', '--socket', '/s', '--', 'agent'])).toBeNull();
    expect(parseRelayArgs(['--listen', '8888', '--socket', '/s'])).toBeNull();
  });

  it('carries bytes from the sandbox listener to the host bridge', async () => {
    const dirPath = await mkdtemp(join(tmpdir(), 'od-egress-'));
    // Windows only allows named pipes for net.Server.listen(path); production is
    // Linux, where this is a real UNIX socket.
    const socketPath = process.platform === 'win32'
      ? '\\\\.\\pipe\\od-egress-' + Math.random().toString(36).slice(2)
      : join(dirPath, 'e.sock');
    const echo = await echoServer();

    const bridge = createEgressBridge({ socketPath, port: echo.port });
    await bridge.start();
    // listen on a free port chosen by the OS
    const relayPort = await new Promise<number>((resolve, reject) => {
      const probe = createNetServer();
      probe.once('error', reject);
      probe.listen(0, '127.0.0.1', () => {
        const port = (probe.address() as AddressInfo).port;
        probe.close(() => resolve(port));
      });
    });
    const realRelay = createEgressRelay({ listenPort: relayPort, socketPath, command: 'x', args: [] });
    await realRelay.start();

    cleanups.push(async () => {
      await realRelay.close();
      await bridge.stop();
      echo.server.close();
      await rm(dirPath, { recursive: true, force: true });
    });

    await expect(roundTrip(relayPort, 'ping-through-relay')).resolves.toBe('ping-through-relay');
  });
});
