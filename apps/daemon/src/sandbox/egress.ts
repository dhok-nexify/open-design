import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createEgressBridge, type EgressBridge } from './egress-bridge.js';
import type { SandboxEgressOptions } from './bwrap-provider.js';

/**
 * NXD-P01 wiring for the sandbox egress relay.
 *
 * Opt-in on purpose: turning it on gives every run a network namespace with no
 * route, and nothing reaches the daemon except the relay socket. That changes
 * what an agent can do, so the deployment chooses it (`OD_SANDBOX_EGRESS=relay`)
 * rather than inheriting it from a build.
 */
export interface ResolvedSandboxEgress {
  options: SandboxEgressOptions | null;
  bridge: EgressBridge | null;
  /** Why the relay is off, when it was asked for. */
  warning?: string;
}

export function resolveSandboxEgress(input: {
  env: NodeJS.ProcessEnv;
  dataDir: string;
  port: number;
  nodeBin?: string;
  relayScript?: string;
}): ResolvedSandboxEgress {
  if (input.env.OD_SANDBOX_EGRESS !== 'relay') return { options: null, bridge: null };
  const relayScript = input.relayScript ?? fileURLToPath(new URL('./egress-relay.js', import.meta.url));
  if (!existsSync(relayScript)) {
    // A source checkout (tsx) has no compiled relay; staying on the host network
    // is the documented behaviour there.
    return {
      options: null,
      bridge: null,
      warning: 'OD_SANDBOX_EGRESS=relay needs the built daemon; egress relay is disabled in this checkout',
    };
  }
  const socketPath = join(input.dataDir, 'sandbox', 'egress.sock');
  return {
    options: {
      socketPath,
      port: input.port,
      relayScript,
      nodeBin: input.nodeBin ?? process.execPath,
    },
    bridge: createEgressBridge({ socketPath, port: input.port }),
  };
}
