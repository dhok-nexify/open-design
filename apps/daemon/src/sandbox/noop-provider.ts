import { scrubSandboxEnv } from './env-scrub.js';
import type { SandboxCommand, SandboxProvider, SandboxRequest } from './provider.js';

/**
 * The upstream execution mode: run the agent CLI directly.
 *
 * Even here the environment is scrubbed of daemon-only secrets so an agent
 * cannot read them out of `env`; only the edition changes how the process is
 * confined.
 */
export function createNoopSandboxProvider(): SandboxProvider {
  return {
    id: 'noop',
    check: { ok: true },
    wrap(request: SandboxRequest): SandboxCommand {
      return {
        command: request.command,
        args: [...request.args],
        env: scrubSandboxEnv(request.env),
      };
    },
  };
}
