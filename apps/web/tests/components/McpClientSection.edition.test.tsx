// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const originalFetch = globalThis.fetch;
const originalEventSource = globalThis.EventSource;

class StubEventSource {
  addEventListener() {}
  close() {}
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

const templates = [
  {
    id: 'remote-http',
    label: 'Remote HTTP',
    description: 'Remote server',
    transport: 'http',
    category: 'utilities',
    url: 'https://mcp.example.test/mcp',
  },
  {
    id: 'local-stdio',
    label: 'Local STDIO',
    description: 'Host command',
    transport: 'stdio',
    category: 'utilities',
    command: 'sh',
    args: ['-c', 'id'],
  },
];

describe('MCP surfaces in the NexTore edition', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    vi.resetModules();
    globalThis.fetch = originalFetch;
    if (originalEventSource) {
      globalThis.EventSource = originalEventSource;
    } else {
      // @ts-expect-error jsdom shim cleanup
      delete globalThis.EventSource;
    }
  });

  it('uses the per-user endpoint and hides stdio templates', async () => {
    vi.stubEnv('NEXT_PUBLIC_OD_EDITION', 'nextore');
    vi.resetModules();
    globalThis.EventSource = StubEventSource as unknown as typeof EventSource;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/nextore/mcp/servers') {
        return jsonResponse({
          servers: [
            {
              id: 'remote-http',
              label: 'Remote HTTP',
              transport: 'http',
              enabled: true,
              authMode: 'none',
              url: 'https://mcp.example.test/mcp',
            },
          ],
          templates,
        });
      }
      if (url === '/api/nextore/mcp/access') {
        return jsonResponse({ allowed: true, enabled: true });
      }
      return jsonResponse({ agents: [] });
    });

    const { I18nProvider } = await import('../../src/i18n');
    const { McpClientSection } = await import('../../src/components/McpClientSection');
    render(
      <I18nProvider initial="en">
        <McpClientSection />
      </I18nProvider>,
    );

    await screen.findByText('Remote HTTP');
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/nextore/mcp/servers');

    fireEvent.click(screen.getByRole('button', { name: 'Add server' }));
    expect((await screen.findAllByText('Remote HTTP')).length).toBeGreaterThan(0);
    expect(screen.queryByText('Local STDIO')).toBeNull();

    fireEvent.click(screen.getByText('Custom server'));
    const expandButtons = await screen.findAllByRole('button', {
      name: 'Expand this MCP server',
    });
    fireEvent.click(expandButtons[expandButtons.length - 1]!);
    const options = screen.getAllByRole('option').map((option) => option.textContent);
    expect(options).toContain('streamable HTTP');
    expect(options).toContain('SSE');
    expect(options).not.toContain('stdio');
  }, 20000);

  it('hides the MCP and Use everywhere tabs without MCP access', async () => {
    vi.stubEnv('NEXT_PUBLIC_OD_EDITION', 'nextore');
    vi.resetModules();
    const { visibleIntegrationTabIds } = await import(
      '../../src/nextore/integration-tabs'
    );

    expect(visibleIntegrationTabIds(false)).toEqual(['skills']);
    expect(visibleIntegrationTabIds(true)).toEqual(['mcp', 'skills']);
  }, 20000);

  it('keeps every integration tab upstream', async () => {
    vi.stubEnv('NEXT_PUBLIC_OD_EDITION', 'upstream');
    vi.resetModules();
    const { visibleIntegrationTabIds } = await import(
      '../../src/nextore/integration-tabs'
    );
    expect(visibleIntegrationTabIds(true)).toEqual([
      'mcp',
      'connectors',
      'skills',
      'use-everywhere',
    ]);
  }, 20000);
});
