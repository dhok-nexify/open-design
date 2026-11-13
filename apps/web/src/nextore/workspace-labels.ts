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
