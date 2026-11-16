// Edition MCP server selection for a run.
//
// The edition injects only the signed-in member's servers and ignores any
// client-supplied toolBundle list; a revoked MCP right or module switch turns
// the list off for the next run. Kept out of `startServer` so upstream
// run-setup changes do not collide with this wiring.

import type { Edition } from '../../edition/index.js';
import type { McpServerConfig } from '../../mcp-config.js';
import type { NextoreSecrets } from '../auth/secrets.js';
import { listNextoreMcpServers } from './store.js';

type McpDb = Parameters<typeof listNextoreMcpServers>[0];

export type RunMcpOptions = {
  edition: Edition;
  memberId: number | null;
  memberMcpEnabled: boolean;
  /** Client-supplied servers; ignored in the edition. */
  toolBundleServers: unknown;
  secrets: (() => NextoreSecrets) | null;
  db: McpDb;
};

/** Resolve the MCP servers a single run may use. */
export function resolveRunMcpServers(options: RunMcpOptions): McpServerConfig[] {
  const { edition, memberId, memberMcpEnabled, toolBundleServers, secrets, db } = options;

  if (edition !== 'nextore') {
    return Array.isArray(toolBundleServers) ? (toolBundleServers as McpServerConfig[]) : [];
  }

  if (!memberMcpEnabled || memberId === null || memberId <= 0 || !secrets) return [];

  try {
    return listNextoreMcpServers(db, secrets(), memberId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[nextore-mcp] member server read failed:', message);
    return [];
  }
}
