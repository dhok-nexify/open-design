import { execFileSync } from 'node:child_process';

import type { SandboxCheck } from './provider.js';

export interface BwrapProbeOptions {
  /** Absolute path or PATH-resolved name of the bwrap binary. */
  bwrapPath?: string;
  /** Injected for tests; defaults to a real `execFileSync`. */
  run?: (file: string, args: readonly string[]) => void;
}

/**
 * Proves bubblewrap exists and can build a namespace on this host.
 *
 * Existence alone is not enough: a kernel without unprivileged user namespaces,
 * or an AppArmor profile that denies the transition, ships a binary that fails
 * on every run. The probe therefore executes a minimal sandbox and only reports
 * `ok` when that succeeds.
 */
export function checkBwrap(options: BwrapProbeOptions = {}): SandboxCheck {
  const bwrapPath = options.bwrapPath ?? 'bwrap';
  const run = options.run ?? ((file, args) => {
    execFileSync(file, [...args], { stdio: 'ignore', timeout: 10_000 });
  });

  try {
    run(bwrapPath, [
      '--die-with-parent',
      '--unshare-pid',
      '--ro-bind',
      '/',
      '/',
      '--dev',
      '/dev',
      '--proc',
      '/proc',
      '--tmpfs',
      '/tmp',
      '/bin/true',
    ]);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'ENOENT') return { ok: false, reason: 'not_found', detail: String(bwrapPath) };
    return {
      ok: false,
      reason: 'probe_failed',
      detail: error instanceof Error ? error.message : String(error),
    };
  }
  return { ok: true };
}
