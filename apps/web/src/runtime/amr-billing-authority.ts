import {
  workspaceResourceReadContext,
  type WorkspaceContextState,
} from '../collab/useWorkspaceContext';
import { workspaceDirectoryUnsupported } from '../collab/workspace-directory-support';
import type { WorkspaceCollabContext } from '@open-design/contracts';

/**
 * The workspace the AMR balance gate may bill against, or null for the account
 * wallet (NXD contract, see workspace-directory-support.ts).
 *
 * Both the pre-submit gate and the post-gate identity re-check must call THIS,
 * because they compare results: two derivations that differ by one rule make
 * every submit on an old daemon look like a stale identity and silently drop
 * the run.
 */
export function amrBillingWorkspaceAuthority(
  state: WorkspaceContextState,
): WorkspaceCollabContext | null {
  if (state.failure === 'unsupported') return null;
  if (workspaceDirectoryUnsupported()) return null;
  return workspaceResourceReadContext(state);
}
