import { describe, expect, it } from 'vitest';

import { describeArtifactError, primaryArtifact } from '../../src/nextore/artifact-client';
import type { NextoreArtifactRecord } from '@open-design/contracts';

function record(overrides: Partial<NextoreArtifactRecord>): NextoreArtifactRecord {
  return {
    projectId: 'p1',
    artifactId: 'a1',
    representation: 'source',
    relativePath: 'index.html',
    treeObjectId: 1,
    currentVersion: 1,
    contentHash: 'a'.repeat(64),
    status: 'published',
    publishedAt: 1,
    updatedAt: 1,
    orphanedAt: null,
    lastError: null,
    ...overrides,
  };
}

describe('primaryArtifact', () => {
  it('prefers the newest source representation', () => {
    const primary = primaryArtifact([
      record({ artifactId: 'old', representation: 'source', updatedAt: 10 }),
      record({ artifactId: 'new', representation: 'source', updatedAt: 20 }),
      record({ artifactId: 'snap', representation: 'snapshot', updatedAt: 30 }),
    ]);
    expect(primary?.artifactId).toBe('new');
  });

  it('falls back to any representation when no source exists', () => {
    const primary = primaryArtifact([record({ artifactId: 'snap', representation: 'snapshot' })]);
    expect(primary?.artifactId).toBe('snap');
  });

  it('returns null for an empty project', () => {
    expect(primaryArtifact([])).toBeNull();
  });
});

describe('describeArtifactError', () => {
  it('groups actionable codes and keeps unknown codes generic', () => {
    expect(describeArtifactError('auth_required')).toBe('auth_required');
    expect(describeArtifactError('snapshot_renderer_unavailable')).toBe('snapshot_unavailable');
    expect(describeArtifactError('versioning_required')).toBe('versioning_required');
    expect(describeArtifactError('folder_share_forbidden')).toBe('folder_share_forbidden');
    expect(describeArtifactError('pin_version_unsupported')).toBe('pin_version_unsupported');
    expect(describeArtifactError('weird')).toBe('generic');
    expect(describeArtifactError(null)).toBe('none');
  });
});
