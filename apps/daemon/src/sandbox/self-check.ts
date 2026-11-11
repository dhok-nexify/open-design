import { execFileSync } from 'node:child_process';

import type { SandboxCheck } from './provider.js';

function readStderr(error: unknown): string {
  const stderr = (error as { stderr?: Buffer | string } | null | undefined)?.stderr;
  if (Buffer.isBuffer(stderr)) return stderr.toString('utf8').trim();
  return typeof stderr === 'string' ? stderr.trim() : '';
}

/**
 * Returns the most useful explanation of a failed probe. bubblewrap writes the
 * actionable reason (AppArmor, user namespaces, missing privileges) to stderr,
 * while Error.message only repeats the command line.
 */
export function describeBwrapProbeFailure(error: unknown): string {
  const stderr = readStderr(error);
  if (stderr) return stderr;
  return error instanceof Error ? error.message : String(error);
}

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
    execFileSync(file, [...args], { stdio: ['ignore', 'ignore', 'pipe'], timeout: 10_000 });
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
      detail: describeBwrapProbeFailure(error),
    };
  }
  return { ok: true };
}
