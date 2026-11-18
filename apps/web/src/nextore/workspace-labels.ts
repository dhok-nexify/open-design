import type { NextoreProjectGroup } from '../nextore-projects';
import type { NextoreProjectScope } from './project-scope';

/**
 * Scope helpers shared by the Home and Projects surfaces (NXD-D40).
 *
 * Both read the same module listing, so the predicate that decides whether a
 * workspace group belongs to the active scope, and the labels that say where a
 * project lives, live here once instead of drifting apart per surface.
 */
export function groupInScope(
  group: NextoreProjectGroup,
  scope: NextoreProjectScope,
): boolean {
  if (scope.kind === 'shared') return group.sharedOnly;
  if (scope.kind === 'workspace') return group.workspaceId === scope.id;
  return true;
}

/** The three capsule kinds a project card can show. */
export type NextoreProjectSpace = 'personal' | 'team' | 'shared';

export interface NextoreProjectSpaceBadge {
  kind: NextoreProjectSpace;
  workspaceName: string;
}

/**
 * projectId -> the capsule badge shown on Home cards, the Projects grid, and
 * search results. Access relationship wins over workspace ownership: a project
 * reached only through a share is "Shared", even when its workspace is a team
 * workspace. The workspace name remains the tooltip, so replacing the old text
 * chip with the badge does not remove information.
 */
export function buildProjectSpaceBadgeMap(
  groups: readonly NextoreProjectGroup[],
): Map<string, NextoreProjectSpaceBadge> {
  const rank: Record<NextoreProjectSpace, number> = { personal: 0, team: 1, shared: 2 };
  const badges = new Map<string, NextoreProjectSpaceBadge>();
  for (const group of groups) {
    const kind: NextoreProjectSpace = group.sharedOnly
      ? 'shared'
      : group.workspaceType === 'team'
        ? 'team'
        : 'personal';
    for (const project of group.projects) {
      const existing = badges.get(project.designerProjectId);
      // A project can appear in both its owning workspace and a shared one.
      // Shared is the strongest access relationship, so it wins regardless of
      // the order the server returned the groups in.
      if (existing && rank[existing.kind] >= rank[kind]) continue;
      badges.set(project.designerProjectId, {
        kind,
        workspaceName: group.workspaceName,
      });
    }
  }
  return badges;
}

/** projectId -> the workspace name that owns it. Unnamed groups are skipped. */
export function buildWorkspaceLabelMap(
  groups: readonly NextoreProjectGroup[],
): Map<string, string> {
  const labels = new Map<string, string>();
  for (const group of groups) {
    if (!group.workspaceName) continue;
    for (const project of group.projects) {
      labels.set(project.designerProjectId, group.workspaceName);
    }
  }
  return labels;
}

/** Projects in the active scope that have no content on this device. */
export function countRemoteOnlyProjects(
  groups: readonly NextoreProjectGroup[],
  scope: NextoreProjectScope,
): number {
  let count = 0;
  for (const group of groups) {
    if (!groupInScope(group, scope)) continue;
    for (const project of group.projects) {
      if (project.hasLocalContent !== true) count += 1;
    }
  }
  return count;
}

/** The designer project ids visible in the active scope. */
export function scopeProjectIds(
  groups: readonly NextoreProjectGroup[],
  scope: NextoreProjectScope,
): Set<string> {
  const ids = new Set<string>();
  for (const group of groups) {
    if (!groupInScope(group, scope)) continue;
    for (const project of group.projects) ids.add(project.designerProjectId);
  }
  return ids;
}
