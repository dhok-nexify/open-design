import { describe, expect, it } from 'vitest';

import { resolvePublishableArtifacts } from '../src/nextore/artifacts/registry.js';

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
      artifactId: 'artifact-1::export::deck.pdf',
      relativePath: 'exports/deck.pdf',
      mimeType: 'application/pdf',
      representation: 'source',
    });
  });
});
