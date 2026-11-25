import { createServer, connect, type Server, type Socket } from 'node:net';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Host side of the sandbox egress relay (NXD-P01).
 *
 * The sandbox runs with `--unshare-net`, so it has no route anywhere - not even
 * to the daemon. This socket is the single file-system path the run may use: a
 * dedicated directory is bind-mounted into the sandbox and the relay inside
 * forwards to it. Everything that leaves the sandbox therefore passes through
 * one place the daemon owns.
 *
 * It is a byte pipe, not a policy engine: the daemon still authorizes each
 * request. Policy (allowlist, audit) belongs in the layer above.
 */
export interface EgressBridge {
  readonly socketPath: string;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export function createEgressBridge(options: {
  socketPath: string;
  port: number;
  host?: string;
}): EgressBridge {
  const host = options.host ?? '127.0.0.1';
  let server: Server | null = null;
  const live = new Set<Socket>();

  return {
    socketPath: options.socketPath,
    async start() {
      mkdirSync(dirname(options.socketPath), { recursive: true });
      // A socket file from a previous process blocks listen() with EADDRINUSE.
      rmSync(options.socketPath, { force: true });
      server = createServer((client) => {
        const upstream = connect(options.port, host);
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
      await new Promise<void>((resolve, reject) => {
        server!.once('error', reject);
        server!.listen(options.socketPath, () => resolve());
      });
    },
    async stop() {
      for (const socket of live) socket.destroy();
      live.clear();
      const closing = server;
      server = null;
      if (!closing) return;
      await new Promise<void>((resolve) => closing.close(() => resolve()));
      rmSync(options.socketPath, { force: true });
    },
  };
}
