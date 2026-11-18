// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../../src/i18n';
import {
  LegacyShareBanner,
  legacyBannerDayCount,
  legacyBucketForProject,
} from '../../src/components/nextore/LegacyShareBanner';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const report = {
  sunsetAt: '2027-02-16T00:00:00.000Z',
  items: [
    { linkId: 'a', projectId: 'p1', expiresAt: null, bucket: 'never' as const },
    { linkId: 'b', projectId: 'p1', expiresAt: 1, bucket: 't7' as const },
    { linkId: 'c', projectId: 'p2', expiresAt: 1, bucket: 't1' as const },
  ],
};

function stub(payload: unknown, status = 200) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })));
}

function renderBanner(projectId = 'p1') {
  render(
    <I18nProvider initial="en">
      <LegacyShareBanner projectId={projectId} />
    </I18nProvider>,
  );
}

describe('legacyBucketForProject', () => {
  it('picks the most urgent bucket for that project only', () => {
    expect(legacyBucketForProject(report, 'p1')).toBe('t7');
    expect(legacyBucketForProject(report, 'p2')).toBe('t1');
    expect(legacyBucketForProject(report, 'p3')).toBeNull();
    expect(legacyBucketForProject(null, 'p1')).toBeNull();
  });

  it('maps buckets to a day count', () => {
    expect(legacyBannerDayCount('t1')).toBe(1);
    expect(legacyBannerDayCount('t7')).toBe(7);
    expect(legacyBannerDayCount('t30')).toBe(30);
    expect(legacyBannerDayCount('never')).toBeNull();
  });
});

describe('LegacyShareBanner', () => {
  it('shows the expiring notice for the current project', async () => {
    stub(report);

    renderBanner('p1');

    expect(await screen.findByRole('status')).toBeTruthy();
    expect(screen.getByText('1 legacy share link(s) for this project expire within 7 days.'))
      .toBeTruthy();
  });

  it('says nothing when the project has no legacy links', async () => {
    stub(report);

    renderBanner('p3');

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('stays silent when the report cannot be read', async () => {
    stub({ error: 'boom' }, 500);

    renderBanner('p1');

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('calls out links that never expire', async () => {
    stub({
      sunsetAt: '2027-02-16T00:00:00.000Z',
      items: [{ linkId: 'a', projectId: 'p1', expiresAt: null, bucket: 'never' }],
    });

    renderBanner('p1');

    expect(await screen.findByText(/never expire/)).toBeTruthy();
  });
});
