import { createServer, connect, type Socket } from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * Sandbox side of the egress relay (NXD-P01).
 *
 * The run's network namespace has no route at all, so the only thing it can
 * reach is this listener on loopback. Each connection is piped to the UNIX
 * socket the host bind-mounted in. The agent keeps using
 * `OD_DAEMON_URL=http://127.0.0.1:<port>` and never learns the path is a socket.
 *
 * Usage: node egress-relay.js --listen <port> --socket <path> -- <command...>
 */
export interface RelayOptions {
  listenPort: number;
  socketPath: string;
  command: string;
  args: readonly string[];
}

export function parseRelayArgs(argv: readonly string[]): RelayOptions | null {
  let listenPort = 0;
  let socketPath = '';
  const separator = argv.indexOf('--');
  const head = separator === -1 ? argv : argv.slice(0, separator);
  const tail = separator === -1 ? [] : argv.slice(separator + 1);
  for (let index = 0; index < head.length; index += 1) {
    if (head[index] === '--listen') listenPort = Number(head[index + 1] ?? 0);
    if (head[index] === '--socket') socketPath = String(head[index + 1] ?? '');
  }
  if (!Number.isInteger(listenPort) || listenPort <= 0 || listenPort > 65535) return null;
  if (!socketPath) return null;
  if (tail.length === 0) return null;
  return { listenPort, socketPath, command: tail[0]!, args: tail.slice(1) };
}

export function createEgressRelay(options: RelayOptions): {
  start: () => Promise<void>;
  close: () => Promise<void>;
} {
  const live = new Set<Socket>();
  const server = createServer((client) => {
    const upstream = connect(options.socketPath);
    live.add(client);
    live.add(upstream);
    const drop = () => {
      client.destroy();
      upstream.destroy();
      live.delete(client);
      live.delete(upstream);
    };
    client.on('error', drop);
    upstream.on('error', drop);
    client.on('close', drop);
    upstream.on('close', drop);
    client.pipe(upstream).pipe(client);
  });
  return {
    start: () => new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(options.listenPort, '127.0.0.1', () => resolve());
    }),
    close: async () => {
      for (const socket of live) socket.destroy();
      live.clear();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/** Entry point when the sandbox runs this file directly. */
export async function runEgressRelay(argv: readonly string[]): Promise<number> {
  const options = parseRelayArgs(argv);
  if (!options) {
    process.stderr.write('[egress-relay] usage: --listen <port> --socket <path> -- <command...>\n');
    return 78;
  }
  const relay = createEgressRelay(options);
  try {
    await relay.start();
  } catch (error) {
    // Fail closed: without the bridge the run would silently lose the daemon.
    process.stderr.write('[egress-relay] cannot listen on 127.0.0.1:' + options.listenPort
      + ' (' + (error instanceof Error ? error.message : String(error)) + ')\n');
    return 78;
  }
  const child = spawn(options.command, [...options.args], { stdio: 'inherit' });
  const forward = (signal: NodeJS.Signals) => child.kill(signal);
  process.once('SIGTERM', () => forward('SIGTERM'));
  process.once('SIGINT', () => forward('SIGINT'));
  const code = await new Promise<number | null>((resolve) => child.on('exit', (value) => resolve(value)));
  await relay.close();
  return code ?? 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void runEgressRelay(process.argv.slice(2)).then((code) => process.exit(code));
}
