import type { Edition } from '@open-design/contracts';

import { createBwrapSandboxProvider } from './bwrap-provider.js';
import { createNoopSandboxProvider } from './noop-provider.js';
import type { SandboxCheck, SandboxProvider } from './provider.js';
import { checkBwrap } from './self-check.js';

export { SandboxUnavailableError } from './provider.js';
export type { SandboxCommand, SandboxProvider, SandboxRequest, SandboxCheck } from './provider.js';
export { buildBwrapArgs } from './bwrap-provider.js';
export { checkBwrap } from './self-check.js';
export { scrubSandboxEnv, isScrubbedSandboxEnvKey } from './env-scrub.js';

export interface ResolveSandboxOptions {
  edition: Edition;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  /** Injected probe, so tests do not need a real bubblewrap install. */
  check?: () => SandboxCheck;
}

/**
 * Picks the sandbox for this process.
 *
 * Upstream keeps the historical direct spawn. The NexTore edition runs every
 * agent inside bubblewrap; when the host cannot provide it the provider reports
 * a failed check and the run path refuses to start rather than silently
 * degrading to an unsandboxed process. `OD_SANDBOX=noop` is the documented
 * development escape hatch and is logged loudly.
 */
export function resolveSandboxProvider(options: ResolveSandboxOptions): SandboxProvider {
  const { edition } = options;
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;

  if (edition !== 'nextore') return createNoopSandboxProvider();
  if (env.OD_SANDBOX === 'noop') return createNoopSandboxProvider();

  const bwrapPath = env.OD_BWRAP_BIN?.trim() || 'bwrap';
  const check = platform !== 'linux'
    ? { ok: false as const, reason: 'unsupported_platform' as const, detail: platform }
    : options.check
      ? options.check()
      : checkBwrap({ bwrapPath });

  // T-D64: production fails closed, a development host degrades to a direct
  // spawn with a loud banner instead of making the whole app unusable when
  // bubblewrap is missing.
  const production = env.NODE_ENV === 'production' || env.OD_PRODUCTION === '1';
  if (!check.ok && !production) {
    return createNoopSandboxProvider();
  }
  return createBwrapSandboxProvider({ bwrapPath, check });
}
