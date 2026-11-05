import type { Edition } from '@open-design/contracts';

/**
 * Spawn-surface gates for the NexTore edition (NXD-D18).
 *
 * The edition runs exactly one agent: the daemon-owned BYOK OpenCode process,
 * already confined by the sandbox. Every other place that could start a host
 * process on behalf of a run has to be closed, or the sandbox boundary is only
 * as strong as its weakest caller.
 */
export function allowsLocalAgentSpawn(edition: Edition): boolean {
  return edition !== 'nextore';
}

export interface McpTransportLike {
  readonly transport?: string;
}

/**
 * MCP servers the agent may receive.
 *
 * `stdio` servers are commands the agent's CLI would spawn on the host; the
 * edition only allows remote transports (`http`/`sse`), which go through the
 * daemon's own request path.
 */
export function filterMcpServersForEdition<T extends McpTransportLike>(
  servers: readonly T[],
  edition: Edition,
): T[] {
  if (edition !== 'nextore') return [...servers];
  return servers.filter((server) => server.transport !== 'stdio');
}
