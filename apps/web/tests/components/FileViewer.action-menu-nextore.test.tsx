// @vitest-environment jsdom
/**
 * NexTore edition: the cloud Share button is hidden, so the unified action
 * popover has no anchor unless Export takes the id over. Regression guard for
 * "clicking Export does nothing" (the shell renders nothing when `anchorId`
 * resolves to no element).
 *
 * The edition module is mocked rather than stubbed through env: setup files run
 * before this file, so an env stub could arrive after features.ts was already
 * evaluated. `vi.mock` is hoisted and keeps us free of `resetModules`, which
 * would hand the component a second React instance.
 */
import { describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

// `vi.mock` is hoisted above the imports below, so features.ts is replaced
// before FileViewer (or any setup file) can read the real edition.
vi.mock('../../src/nextore/features', () => ({
  NEXTORE_WEB_EDITION: 'nextore',
  isFeatureEnabled: () => false,
}));

import { FileViewer } from '../../src/components/FileViewer';
import type { ProjectFile } from '../../src/types';

function htmlFile(): ProjectFile {
  return {
    name: 'index.html',
    path: 'index.html',
    type: 'file',
    size: 1024,
    mtime: 1710000000,
    kind: 'html',
    mime: 'text/html',
    artifactManifest: {
      version: 1, kind: 'html', title: 'Page', entry: 'index.html',
      renderer: 'html', exports: ['html'],
    },
  } as ProjectFile;
}

function stubFetch() {
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
    if (url.includes('/deployments')) return new Response(JSON.stringify({ deployments: [] }), { status: 200 });
    if (url.includes('/deploy/config')) return new Response(JSON.stringify({ providerId: 'cloudflare-pages', configured: false }), { status: 200 });
    return new Response(JSON.stringify({}), { status: 200 });
  }));
}

describe('FileViewer toolbar in the NexTore edition', () => {
  it('opens the export menu even though the cloud Share button is absent', async () => {
    stubFetch();
    render(
      <FileViewer
        projectId="project-1"
        projectKind="prototype"
        file={htmlFile()}
        liveHtml="<html><body><h1>Hello</h1></body></html>"
      />,
    );

    const exportButton = await waitFor(() => {
      const node = document.querySelector<HTMLButtonElement>(
        'button.chrome-action-unified[aria-label="Export"]',
      );
      expect(node).not.toBeNull();
      return node!;
    });

    // The cloud share entry must be gone in this edition.
    expect(document.querySelector('button.chrome-action-unified[aria-label="Share"]')).toBeNull();

    // The popover only mounts when its anchor exists, so "the export row
    // appears" is exactly the assertion that fails without the fallback anchor.
    fireEvent.click(exportButton);
    await waitFor(() => {
      expect(screen.queryByRole('menuitem', { name: /Export as PDF/i })).not.toBeNull();
    });
    cleanup();
    vi.unstubAllGlobals();
  });
});
