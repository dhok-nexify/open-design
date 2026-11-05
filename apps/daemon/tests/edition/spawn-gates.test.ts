import { afterEach, describe, expect, it } from 'vitest';

import {
  allowsLocalAgentSpawn,
  filterMcpServersForEdition,
} from '../../src/edition/spawn-gates.js';
import {
  buildAcpMcpServers,
  buildClaudeMcpJson,
  buildOpenCodeMcpConfigContent,
  type McpServerConfig,
} from '../../src/mcp-config.js';

const STDIO_SERVER: McpServerConfig = {
  id: 'local-tools',
  enabled: true,
  transport: 'stdio',
  command: '/usr/local/bin/local-tools',
  args: ['--serve'],
};

const HTTP_SERVER: McpServerConfig = {
  id: 'remote-tools',
  enabled: true,
  transport: 'http',
  url: 'https://mcp.example.test/sse',
};

const originalEdition = process.env.OD_EDITION;

afterEach(() => {
  if (originalEdition === undefined) delete process.env.OD_EDITION;
  else process.env.OD_EDITION = originalEdition;
});

describe('allowsLocalAgentSpawn', () => {
  it('is open upstream and closed in the edition', () => {
    expect(allowsLocalAgentSpawn('upstream')).toBe(true);
    expect(allowsLocalAgentSpawn('nextore')).toBe(false);
  });
});

describe('filterMcpServersForEdition', () => {
  it('drops stdio servers in the edition and keeps remote ones', () => {
    const filtered = filterMcpServersForEdition([STDIO_SERVER, HTTP_SERVER], 'nextore');
    expect(filtered.map((server) => server.id)).toEqual(['remote-tools']);
  });

  it('keeps every server upstream', () => {
    const filtered = filterMcpServersForEdition([STDIO_SERVER, HTTP_SERVER], 'upstream');
    expect(filtered.map((server) => server.id)).toEqual(['local-tools', 'remote-tools']);
  });
});

describe('agent-facing MCP configs', () => {
  it('never exposes a stdio command to the agent in the edition', () => {
    process.env.OD_EDITION = 'nextore';
    const servers = [STDIO_SERVER, HTTP_SERVER];

    const claude = buildClaudeMcpJson(servers) as { mcpServers: Record<string, unknown> };
    expect(Object.keys(claude.mcpServers)).toEqual(['remote-tools']);

    expect(buildAcpMcpServers(servers)).toEqual([]);

    const opencode = buildOpenCodeMcpConfigContent(servers);
    expect(opencode).not.toBeNull();
    const parsed = JSON.parse(opencode as string) as { mcp: Record<string, { type: string }> };
    expect(Object.keys(parsed.mcp)).toEqual(['remote-tools']);
    expect(parsed.mcp['remote-tools']?.type).toBe('remote');
  });

  it('keeps the stdout config upstream', () => {
    delete process.env.OD_EDITION;
    const claude = buildClaudeMcpJson([STDIO_SERVER, HTTP_SERVER]) as {
      mcpServers: Record<string, unknown>;
    };
    expect(Object.keys(claude.mcpServers)).toEqual(['local-tools', 'remote-tools']);
    expect(buildAcpMcpServers([STDIO_SERVER])).toHaveLength(1);
  });
});
