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

function installFetch(memoryEnabled: boolean): void {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/memory') {
      return jsonResponse({
        enabled: memoryEnabled,
        moduleEnabled: memoryEnabled,
        chatExtractionEnabled: false,
        profileEnabled: false,
        rewriteEnabled: false,
        verifyEnabled: false,
        rootDir: '/tmp/member-42/memory',
        index: '',
        entries: [],
        extraction: null,
      });
    }
    if (url === '/api/memory/tree') {
      return jsonResponse({
        enabled: memoryEnabled,
        moduleEnabled: memoryEnabled,
        rootDir: '/tmp/member-42/memory',
        tree: [],
      });
    }
    if (url === '/api/memory/extractions') {
      return jsonResponse({ extractions: [] });
    }
    return jsonResponse({});
  });
}

describe('MemorySection NexTore edition', () => {
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

  it('locks the pane when MemoryEnabled is off and hides connector memory', async () => {
    vi.stubEnv('NEXT_PUBLIC_OD_EDITION', 'nextore');
    vi.resetModules();
    globalThis.EventSource = StubEventSource as unknown as typeof EventSource;
    installFetch(false);

    const { I18nProvider } = await import('../../src/i18n');
    const { MemorySection } = await import('../../src/components/MemorySection');
    render(
      <I18nProvider initial="en">
        <MemorySection />
      </I18nProvider>,
    );

    const toggle = await screen.findByRole('checkbox', { name: 'Enable memory injection' });
    expect((toggle as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText(/Memory is currently OFF/)).toBeTruthy();
    const add = screen.getByRole('button', { name: 'Add or import memories' });
    expect((add as HTMLButtonElement).disabled).toBe(true);

    // Re-render with the module switch on: the source picker still must not
    // offer the connector/import source in the edition.
    cleanup();
    installFetch(true);
    render(
      <I18nProvider initial="en">
        <MemorySection />
      </I18nProvider>,
    );
    fireEvent.click(
      await screen.findByRole('button', { name: 'Add or import memories' }),
    );
    expect(await screen.findByRole('tab', { name: 'Add manually' })).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'Import from apps' })).toBeNull();
  }, 20000);
});
