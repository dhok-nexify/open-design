/**
 * The member's NexTore project list, as the daemon reports it (NXD-D09).
 *
 * `remoteWithoutLocal` is the set of projects that exist in NexTore but have no
 * content on this device. They are worth showing — the member can see that work
 * exists elsewhere — but they cannot be opened here until content sync lands.
 */
export interface NextoreProjectEntry {
  nextoreProjectId: string;
  designerProjectId: string;
  name: string;
  designSystemId?: string | null;
  skillId?: string | null;
  status?: string | null;
  hasLocalContent?: boolean;
  /** Workspace the module reports the project in (NXD-D09). */
  workspaceId?: number;
  workspaceName?: string;
  workspaceType?: string;
}

export interface NextoreWorkspaceEntry {
  id: number;
  name: string;
  type: string;
}

export interface NextoreProjectListing {
  projects: NextoreProjectEntry[];
  /** Server-ordered workspaces, including ones with no projects yet. */
  workspaces?: NextoreWorkspaceEntry[];
  remoteWithoutLocal: string[];
  localWithoutRemote: string[];
}

export interface NextoreProjectGroup {
  workspaceId: number | null;
  workspaceName: string;
  workspaceType: string;
  projects: NextoreProjectEntry[];
}

export function remoteOnlyProjects(
  listing: NextoreProjectListing | null | undefined,
): NextoreProjectEntry[] {
  if (!listing || !Array.isArray(listing.projects)) return [];
  return listing.projects.filter((project) => project?.hasLocalContent !== true && project?.name);
}

/**
 * Groups the flat project list into the workspace buckets the sidebar renders.
 *
 * The server owns workspace order and includes empty workspaces; projects
 * without workspace metadata (an older daemon) fall into one trailing group
 * rather than disappearing.
 */
export function groupProjectsByWorkspace(
  listing: NextoreProjectListing | null | undefined,
): NextoreProjectGroup[] {
  if (!listing) return [];
  const groups: NextoreProjectGroup[] = (listing.workspaces ?? [])
    .filter((workspace) => Number.isFinite(workspace?.id))
    .map((workspace) => ({
      workspaceId: workspace.id,
      workspaceName: workspace.name?.trim() || '',
      workspaceType: workspace.type?.trim() || '',
      projects: [],
    }));
  const byId = new Map<number, NextoreProjectGroup>(
    groups.map((group) => [group.workspaceId as number, group]),
  );
  const unassigned: NextoreProjectGroup = {
    workspaceId: null,
    workspaceName: '',
    workspaceType: '',
    projects: [],
  };
  for (const project of listing.projects ?? []) {
    if (!project?.name) continue;
    const workspaceId = typeof project.workspaceId === 'number' ? project.workspaceId : null;
    let group = workspaceId == null ? undefined : byId.get(workspaceId);
    if (!group) {
      group = {
        workspaceId,
        workspaceName: project.workspaceName?.trim() || '',
        workspaceType: project.workspaceType?.trim() || '',
        projects: [],
      };
      if (workspaceId == null) {
        group = unassigned;
      } else {
        byId.set(workspaceId, group);
        groups.push(group);
      }
    }
    if (!group.projects.some((item) => item.designerProjectId === project.designerProjectId)) {
      group.projects.push(project);
    }
  }
  if (unassigned.projects.length > 0) groups.push(unassigned);
  return groups;
}

export async function fetchNextoreProjectListing(
  fetchImpl: typeof fetch = fetch,
): Promise<NextoreProjectListing | null> {
  try {
    const response = await fetchImpl('/api/nextore/projects', {
      headers: { accept: 'application/json' },
    });
    if (!response.ok) return null;
    const body = (await response.json()) as Partial<NextoreProjectListing>;
    return {
      projects: Array.isArray(body.projects) ? body.projects : [],
      workspaces: Array.isArray(body.workspaces) ? body.workspaces : [],
      remoteWithoutLocal: Array.isArray(body.remoteWithoutLocal) ? body.remoteWithoutLocal : [],
      localWithoutRemote: Array.isArray(body.localWithoutRemote) ? body.localWithoutRemote : [],
    };
  } catch {
    return null;
  }
}
