import { describe, expect, it } from 'vitest';

import {
  isPublishableNextorePath,
  resolvePublishableArtifacts,
} from '../src/nextore/artifacts/registry.js';

const base = {
  projectId: 'project-1',
  artifactId: 'artifact-1',
  runId: 'run-1',
  tier: 'expert' as const,
  deliverable: {
    valid: true,
    entryFile: 'index.html',
    artifactKind: 'html',
    linkedPage: null,
  },
};

describe('resolvePublishableArtifacts', () => {
  it('publishes the finalized entry file as the source representation', () => {
    const result = resolvePublishableArtifacts(base);

    expect(result).toEqual([{
      projectId: 'project-1',
      artifactId: 'artifact-1',
      representation: 'source',
      relativePath: 'index.html',
      name: 'index.html',
      mimeType: 'text/html',
      sourcePath: 'index.html',
      runId: 'run-1',
      tier: 'expert',
    }]);
  });

  it('publishes nothing when the deliverable is invalid or has no entry file', () => {
    expect(resolvePublishableArtifacts({
      ...base,
      deliverable: { ...base.deliverable, valid: false },
    })).toEqual([]);
    expect(resolvePublishableArtifacts({
      ...base,
      deliverable: { ...base.deliverable, entryFile: null },
    })).toEqual([]);
  });

  it('rejects path traversal and absolute paths', () => {
    expect(resolvePublishableArtifacts({
      ...base,
      deliverable: { ...base.deliverable, entryFile: '../secret.html' },
    })).toEqual([]);
    expect(resolvePublishableArtifacts({
      ...base,
      deliverable: { ...base.deliverable, entryFile: '/etc/passwd' },
    })).toEqual([]);
  });

  it('adds explicit exports as separate source artifacts without scanning the workspace', () => {
    const result = resolvePublishableArtifacts({
      ...base,
      exportedFiles: ['exports/deck.pdf', 'index.html', 'exports/deck.pdf'],
    });

    expect(result).toHaveLength(2);
    expect(result[1]).toMatchObject({
      artifactId: 'artifact-1::export::exports__deck.pdf',
      relativePath: 'exports/deck.pdf',
      mimeType: 'application/pdf',
      representation: 'source',
    });
  });

  it('publishes generated pages and static dependencies but not hidden or cache files', () => {
    const result = resolvePublishableArtifacts({
      ...base,
      exportedFiles: [
        'chapters/one.html',
        'assets/site.css',
        'assets/app.js',
        'assets/logo.png',
        'assets/font.woff2',
        '.od-state/session.json',
        'node_modules/pkg/index.js',
        'cache/preview.html',
        'assets/scratch.tmp',
      ],
    });

    expect(result.map((artifact) => artifact.relativePath)).toEqual([
      'index.html',
      'chapters/one.html',
      'assets/site.css',
      'assets/app.js',
      'assets/logo.png',
      'assets/font.woff2',
    ]);
    expect(result.at(5)?.mimeType).toBe('font/woff2');
  });

  it('exposes the same whitelist to run publication and watcher adoption', () => {
    expect(isPublishableNextorePath('assets/site.css')).toBe(true);
    expect(isPublishableNextorePath('assets/font.woff2')).toBe(true);
    expect(isPublishableNextorePath('.od-state/session.json')).toBe(false);
    expect(isPublishableNextorePath('../secret.html')).toBe(false);
  });

  it('keeps distinct artifact ids for files that share a basename', () => {
    const result = resolvePublishableArtifacts({
      ...base,
      exportedFiles: ['a/logo.png', 'b/logo.png'],
    });
    const firstId = result.at(1)?.artifactId;
    expect(firstId).toBeDefined();
    expect(firstId).not.toBe(result.at(2)?.artifactId);
  });
});
