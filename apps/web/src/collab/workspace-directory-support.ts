/**
 * Whether the running daemon can answer GET /api/workspace/directory.
 *
 * Two workspace endpoints answer two different questions, and the billing gate
 * needs both before it spends against a workspace:
 *
 *  - GET /api/workspace/context - "which workspace am I standing on?"
 *  - GET /api/workspace/directory - "which workspaces can this signed-in
 *    account actually claim?"
 *
 * A daemon that 404s the directory cannot answer the second question, so a
 * selection retained in localStorage is only a claim, not a verified
 * authority. Billing decisions must then fall back to the account scope, which
 * is the only wallet an old daemon can actually charge. Anything other than a
 * 404 (network blip, 5xx) is "unknown" and deliberately does NOT demote: a
 * transient failure must not silently move spend off the team wallet the
 * account was verified against.
 *
 * The verdict is partitioned on the Workspace account generation, not on the
 * context fields: daemon capability belongs to the account boundary, and a
 * sign-in can leave every context value identical while the authority behind
 * it has changed.
 */
import { currentWorkspaceAccountGeneration } from './workspace-identity';

export type WorkspaceDirectorySupport = 'supported' | 'unsupported' | 'unknown';

let recorded: { generation: number; status: WorkspaceDirectorySupport } | null = null;

export function noteWorkspaceDirectorySupport(status: WorkspaceDirectorySupport): void {
  recorded = { generation: currentWorkspaceAccountGeneration(), status };
}

export function workspaceDirectoryUnsupported(): boolean {
  return recorded?.generation === currentWorkspaceAccountGeneration()
    && recorded.status === 'unsupported';
}

/** Test seam: the verdict is module state, so suites must not inherit it. */
export function resetWorkspaceDirectorySupport(): void {
  recorded = null;
}
