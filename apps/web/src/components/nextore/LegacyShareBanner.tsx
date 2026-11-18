import { useEffect, useState } from 'react';

import { useT } from '../../i18n';
import { Icon } from '../Icon';
import styles from './LegacyShareBanner.module.css';

interface SunsetItem {
  linkId: string;
  projectId: string;
  expiresAt: number | null;
  bucket: 'expired' | 't1' | 't7' | 't30' | 'later' | 'never';
}

interface SunsetReport {
  sunsetAt: string | null;
  items: SunsetItem[];
}

/** The soonest bucket present for this project, in escalation order. */
export function legacyBucketForProject(
  report: SunsetReport | null,
  projectId: string,
): SunsetItem['bucket'] | null {
  if (!report) return null;
  const order: Array<SunsetItem['bucket']> = ['expired', 't1', 't7', 't30', 'never', 'later'];
  const buckets = new Set(
    report.items.filter((item) => item.projectId === projectId).map((item) => item.bucket),
  );
  return order.find((bucket) => buckets.has(bucket)) ?? null;
}

export function legacyBannerDayCount(bucket: SunsetItem['bucket'] | null): number | null {
  switch (bucket) {
    case 't1': return 1;
    case 't7': return 7;
    case 't30': return 30;
    default: return null;
  }
}

/**
 * Legacy `/s/<token>` notice (P04f).
 *
 * Legacy links keep working until the announced sunset, but they are no longer
 * the sharing path. The banner is advisory: a failed read stays silent rather
 * than blocking the artifact dialog.
 */
export function LegacyShareBanner({ projectId }: { projectId: string }) {
  const t = useT();
  const [report, setReport] = useState<SunsetReport | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch('/api/nextore/share-links/sunset-report', {
          headers: { accept: 'application/json' },
        });
        if (!response.ok) return;
        const payload = await response.json() as SunsetReport;
        if (!cancelled && Array.isArray(payload?.items)) setReport(payload);
      } catch {
        // Advisory only; the dialog keeps working without it.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const bucket = legacyBucketForProject(report, projectId);
  if (!bucket) return null;

  const count = report!.items.filter(
    (item) => item.projectId === projectId && item.bucket === bucket,
  ).length;
  const days = legacyBannerDayCount(bucket);
  const message = bucket === 'expired'
    ? t('nextore.artifact.legacy.expired', { count: String(count) })
    : bucket === 'never'
      ? t('nextore.artifact.legacy.never', { count: String(count) })
      : t('nextore.artifact.legacy.expiresIn', {
        count: String(count),
        days: String(days ?? 30),
      });

  return (
    <p className={styles.banner} role="status" aria-live="polite" data-bucket={bucket}>
      <Icon name="info" size={14} aria-hidden="true" />
      <span>{message}</span>
    </p>
  );
}
