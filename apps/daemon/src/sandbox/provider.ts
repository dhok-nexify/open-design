import type { Edition } from '@open-design/contracts';

/** A command line after the sandbox has rewritten it. */
export interface SandboxCommand {
  command: string;
  args: string[];
  env: Record<string, string>;
}

/** What a run asks the sandbox to execute. */
export interface SandboxRequest {
  command: string;
  args: readonly string[];
  cwd: string;
  env: Readonly<Record<string, string>>;
}

export interface SandboxCheck {
  ok: boolean;
  /** Machine-readable reason when `ok` is false. */
  reason?: 'not_found' | 'probe_failed' | 'unsupported_platform' | 'disabled';
  detail?: string;
}

export interface SandboxProvider {
  readonly id: 'noop' | 'bwrap';
  readonly check: SandboxCheck;
  wrap(request: SandboxRequest): SandboxCommand;
}

/**
 * Thrown when a run cannot start because the edition requires a sandbox the
 * host cannot provide. Failing closed is the contract: a NexTore deployment
 * that cannot isolate the agent must not silently run it unsandboxed.
 */
export class SandboxUnavailableError extends Error {
  readonly code = 'SANDBOX_UNAVAILABLE';

  constructor(readonly check: SandboxCheck) {
    super(
      'The execution sandbox is unavailable on this host (' +
        (check.reason ?? 'unknown') +
        (check.detail ? ': ' + check.detail : '') +
        '). Install bubblewrap and retry, or set OD_SANDBOX=noop only for a development host.',
    );
    this.name = 'SandboxUnavailableError';
  }
}
