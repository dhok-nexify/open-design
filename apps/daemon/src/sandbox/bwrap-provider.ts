import { scrubSandboxEnv } from './env-scrub.js';
import type { SandboxCheck, SandboxCommand, SandboxProvider, SandboxRequest } from './provider.js';

export interface SandboxEgressOptions {
  /** UNIX socket the host bridge listens on; the sandbox reaches nothing else. */
  socketPath: string;
  /** Port the sandbox-local relay listens on, matching OD_DAEMON_URL's port. */
  port: number;
  /** Absolute path of the compiled relay entry (dist/sandbox/egress-relay.js). */
  relayScript: string;
  /** Node binary inside the sandbox (the host path; / is bind-mounted). */
  nodeBin: string;
}

export interface BwrapProviderOptions {
  bwrapPath: string;
  check: SandboxCheck;
  /** NXD-P01: when set the run gets its own netns and only the relay socket. */
  egress?: SandboxEgressOptions | null;
}

/** Where the sandboxed process sees its home. Lives in a tmpfs, so it is gone after the run. */
export const SANDBOX_HOME = '/tmp/od-sandbox-home';

/**
 * bubblewrap argument builder.
 *
 * The whole filesystem is mounted read-only, then the run's working directory
 * is re-bound read-write on top of it. Nothing else becomes writable, so `ls ..`
 * still sees the host layout but `cat`/`touch` outside the project fail. HOME is
 * a tmpfs so agent state cannot leak between runs and disappears with the
 * sandbox. The network is shared because the agent reaches the daemon's BYOK
 * proxy on loopback; egress policy is a separate layer (NXD-P01).
 *
 * `--new-session` plus `--die-with-parent` keep job control and signal
 * handling intact while guaranteeing the sandbox dies with the daemon, which is
 * what makes run cancellation kill the whole tree.
 */
export function buildBwrapArgs(
  request: SandboxRequest,
  egress?: SandboxEgressOptions | null,
): string[] {
  const cwd = request.cwd;
  // NXD-P01: without egress the sandbox shares the host network (the historical
  // behaviour). With it the run gets a namespace with no route at all and the
  // only reachable thing is the relay on loopback, fed by a UNIX socket.
  const network = egress ? ['--unshare-net'] : ['--share-net'];
  const relay = egress
    ? [
        egress.nodeBin,
        egress.relayScript,
        '--listen',
        String(egress.port),
        '--socket',
        egress.socketPath,
        '--',
      ]
    : [];
  return [
    '--die-with-parent',
    '--new-session',
    '--unshare-pid',
    '--unshare-uts',
    '--unshare-ipc',
    ...network,
    '--ro-bind',
    '/',
    '/',
    '--bind',
    cwd,
    cwd,
    '--dev',
    '/dev',
    '--proc',
    '/proc',
    // /tmp becomes a writable tmpfs BEFORE the nested sandbox HOME below:
    // bubblewrap creates that mount point inside /tmp while the host tree is
    // still the read-only bind above. Reversing these two blocks produced
    // bwrap: Can't mkdir /tmp/od-sandbox-home: Read-only file system.
    '--tmpfs',
    '/tmp',
    '--tmpfs',
    SANDBOX_HOME,
    '--setenv',
    'HOME',
    SANDBOX_HOME,
    '--chdir',
    cwd,
    '--',
    ...relay,
    request.command,
    ...request.args,
  ];
}

export function createBwrapSandboxProvider(options: BwrapProviderOptions): SandboxProvider {
  return {
    id: 'bwrap',
    check: options.check,
    wrap(request: SandboxRequest): SandboxCommand {
      return {
        command: options.bwrapPath,
        args: buildBwrapArgs(request, options.egress ?? null),
        env: { ...scrubSandboxEnv(request.env), HOME: SANDBOX_HOME },
      };
    },
  };
}
