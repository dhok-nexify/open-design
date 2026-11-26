// Cached execution-sandbox probe for the NexTore health surface.
//
// The probe is only reported in the edition, and it is cached so a health poll
// cannot spawn a bubblewrap check on every request. Kept out of `server.ts` so
// upstream health-handler changes do not collide with this wiring.

import type { Edition } from '../edition/index.js';
import { checkBwrap } from '../sandbox/self-check.js';

export type SandboxHealth = {
  ok: boolean;
  mode: 'bwrap' | 'noop';
  reason?: string;
  detail?: string;
  /**
   * How the sandbox can reach the network (NXD-P01). "relay" means the run has
   * no route and only the daemon is reachable; modelProxy says whether BYOK
   * traffic is fronted by the per-run capability proxy. Together these are the
   * audit answer to "what could this run talk to?".
   */
  egress?: {
    relay: boolean;
    modelProxy: boolean;
  };
};

const SANDBOX_HEALTH_TTL_MS = 30_000;
// Keep failures short so an operator who fixes the host sees the result
// without restarting the daemon.
const SANDBOX_HEALTH_FAILURE_TTL_MS = 10_000;

let cache: { at: number; value: SandboxHealth } | null = null;

/**
 * The egress posture this process is actually running with. Read from env, but
 * keyed the same way `server.ts` decides it, so health cannot claim a mode the
 * runs do not have.
 */
function readEgressPosture(): { relay: boolean; modelProxy: boolean } {
  const relay = process.env.OD_SANDBOX_EGRESS === 'relay';
  return {
    relay,
    modelProxy: relay || process.env.OD_BYOK_PROXY === 'on',
  };
}

/** Sandbox status for the health payload, or undefined outside the edition. */
export function readSandboxHealth(edition: Edition): SandboxHealth | undefined {
  if (edition !== 'nextore') return undefined;

  const now = Date.now();
  const cacheTtl = cache?.value.ok === false ? SANDBOX_HEALTH_FAILURE_TTL_MS : SANDBOX_HEALTH_TTL_MS;
  if (!cache || now - cache.at > cacheTtl) {
    const mode = process.env.OD_SANDBOX === 'noop' ? 'noop' : 'bwrap';
    cache = {
      at: now,
      value: mode === 'noop'
        ? { ok: true, mode, egress: readEgressPosture() }
        : {
          ...checkBwrap({ bwrapPath: process.env.OD_BWRAP_BIN?.trim() || 'bwrap' }),
          mode,
          egress: readEgressPosture(),
        },
    };
  }
  return cache.value;
}
