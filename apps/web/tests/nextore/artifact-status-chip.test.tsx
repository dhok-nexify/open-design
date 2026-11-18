// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  NextoreArtifactRecord,
  NextoreArtifactRepresentationStatus,
} from '@open-design/contracts';

import { I18nProvider } from '../../src/i18n';
import {
  ArtifactStatusChip,
  resolveArtifactChipState,
} from '../../src/components/nextore/ArtifactStatusChip';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function row(
  status: NextoreArtifactRecord['status'],
  overrides: Partial<NextoreArtifactRecord> = {},
): NextoreArtifactRepresentationStatus {
  return {
    representation: 'source',
    artifact: {
      projectId: 'p1',
      artifactId: 'a1',
      representation: 'source',
      relativePath: 'index.html',
      treeObjectId: 10,
      currentVersion: 3,
      contentHash: 'a'.repeat(64),
      status,
      publishedAt: 1,
      updatedAt: 1,
      orphanedAt: null,
      lastError: null,
      ...overrides,
    },
    queue: {
      pending: status === 'publish_pending',
      attempts: 0,
      nextAttemptAt: null,
      deadLettered: false,
      lastError: null,
    },
    share: null,
  };
}

function renderChip() {
  return render(
    <I18nProvider initial="en">
      <ArtifactStatusChip projectId="p1" artifactId="a1" />
    </I18nProvider>,
  );
}

function stubStatus(payload: { representations: NextoreArtifactRepresentationStatus[] }) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })));
}

describe('resolveArtifactChipState', () => {
  it('maps every record status to a distinct chip state', () => {
    expect(resolveArtifactChipState(null, false)).toBe('not_published');
    expect(resolveArtifactChipState(row('publish_pending'), false)).toBe('publishing');
    expect(resolveArtifactChipState(row('published'), false)).toBe('published');
    expect(resolveArtifactChipState(row('failed'), false)).toBe('failed');
    expect(resolveArtifactChipState(row('orphaned'), false)).toBe('missing');
    expect(resolveArtifactChipState(row('published'), true)).toBe('unavailable');
  });
});

describe('ArtifactStatusChip', () => {
  it('shows the published version from the status API', async () => {
    stubStatus({ representations: [row('published')] });

    renderChip();

    expect(await screen.findByText('Published v3')).toBeTruthy();
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('shows Not published when the representation has no record', async () => {
    stubStatus({ representations: [] });

    renderChip();

    expect(await screen.findByText('Not published')).toBeTruthy();
  });

  it('surfaces a failure as an alert with a retry action', async () => {
    stubStatus({ representations: [row('failed', { lastError: 'versioning_required' })] });

    renderChip();

    expect(await screen.findByText('Publish failed')).toBeTruthy();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(screen.getByText('Ask an administrator to enable versioning on this repository.')).toBeTruthy();
  });

  it('reports an unavailable status instead of an optimistic success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })));

    renderChip();

    expect(await screen.findByText('Status unavailable')).toBeTruthy();
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('renders the publishing state with a live region', async () => {
    stubStatus({ representations: [row('publish_pending')] });

    renderChip();

    await waitFor(() => expect(screen.getByText('Publishing…')).toBeTruthy());
    expect(screen.getByRole('status')).toBeTruthy();
  });
});
