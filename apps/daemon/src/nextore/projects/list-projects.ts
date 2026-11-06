import type { NextoreClient } from '../client.js';
import type { NextoreWorkspaceSummary } from './register-project.js';

export interface NextoreProjectSummary {
  id: number;
  name: string;
  designerProjectId: string;
  designSystemId?: string | null;
  skillId?: string | null;
  status?: string | null;
}

export interface ListedNextoreProject {
  nextoreProjectId: string;
  designerProjectId: string;
  name: string;
  designSystemId: string | null;
  skillId: string | null;
  status: string | null;
  /** True when this daemon has a local row for the project. */
  hasLocalContent: boolean;
}

export interface NextoreProjectListing {
  projects: ListedNextoreProject[];
  /** NexTore knows these, this daemon has no content for them. */
  remoteWithoutLocal: string[];
  /** This daemon has this project, NexTore does not (orphan candidate for GC). */
  localWithoutRemote: string[];
}

/**
 * Reads the member's project list from NexTore and reconciles it with what this
 * daemon has locally (NXD-D08).
 *
 * Listing is read-only on purpose: the two mismatch lists are reported so an
 * operator or a later GC step can decide what to do. A project known only to
 * NexTore has no content on this host yet; a project known only locally is an
 * orphan the module no longer vouches for.
 */
export async function listNextoreProjects(input: {
  client: NextoreClient;
  accessToken: string;
  localProjectIds: readonly string[];
}): Promise<NextoreProjectListing> {
  const workspacesResponse = await input.client.workspaces<{
    workspaces?: NextoreWorkspaceSummary[];
  }>(input.accessToken);
  const workspaces = workspacesResponse?.workspaces ?? [];

  const summaries: NextoreProjectSummary[] = [];
  for (const workspace of workspaces) {
    try {
      const response = await input.client.workspaceProjects<{
        projects?: NextoreProjectSummary[];
      }>(input.accessToken, workspace.id);
      summaries.push(...(response?.projects ?? []));
    } catch {
      // One workspace the member cannot read must not hide the others.
    }
  }

  const seen = new Set<string>();
  const localIds = new Set(input.localProjectIds);
  const projects: ListedNextoreProject[] = [];
  for (const summary of summaries) {
    const designerProjectId = summary.designerProjectId?.trim();
    if (!designerProjectId || seen.has(designerProjectId)) continue;
    seen.add(designerProjectId);
    projects.push({
      nextoreProjectId: String(summary.id),
      designerProjectId,
      name: summary.name,
      designSystemId: summary.designSystemId?.trim() || null,
      skillId: summary.skillId?.trim() || null,
      status: summary.status?.trim() || null,
      hasLocalContent: localIds.has(designerProjectId),
    });
  }

  return {
    projects,
    remoteWithoutLocal: projects
      .filter((project) => !project.hasLocalContent)
      .map((project) => project.designerProjectId),
    localWithoutRemote: input.localProjectIds.filter((id) => !seen.has(id)),
  };
}
