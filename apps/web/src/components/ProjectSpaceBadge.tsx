'use client';

import { Icon } from './Icon';
import { useT } from '../i18n';
import type { NextoreProjectSpace, NextoreProjectSpaceBadge } from '../nextore/workspace-labels';
import styles from './ProjectSpaceBadge.module.css';

const ICON: Record<NextoreProjectSpace, 'user' | 'users' | 'link'> = {
  personal: 'user',
  team: 'users',
  shared: 'link',
};

type DictKey = Parameters<ReturnType<typeof useT>>[0];
const LABEL_KEY: Record<NextoreProjectSpace, DictKey> = {
  personal: 'projectSpace.personal',
  team: 'projectSpace.team',
  shared: 'projectSpace.shared',
};

/**
 * The compact project-space capsule shared by Home cards, the Projects grid and
 * the search palette. Shared wins over Team/Personal because it describes why
 * the member can see the project, not who owns the workspace.
 */
export function ProjectSpaceBadge({
  badge,
  className,
}: {
  badge: NextoreProjectSpaceBadge;
  className?: string;
}) {
  const t = useT();
  const label = t(LABEL_KEY[badge.kind]);
  const title = badge.workspaceName.trim()
    ? label + ': ' + badge.workspaceName
    : label;

  return (
    <span
      className={[styles.badge, styles[badge.kind], className].filter(Boolean).join(' ')}
      title={title}
      aria-label={title}
    >
      <Icon name={ICON[badge.kind]} size={11} className={styles.icon} />
      <span className={styles.label}>{label}</span>
    </span>
  );
}
