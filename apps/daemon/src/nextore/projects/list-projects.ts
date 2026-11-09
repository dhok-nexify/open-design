import type { NextoreClient } from '../client.js';
import type { NextoreWorkspaceSummary } from './register-project.js';
import { wireArray, wireNumber, wireString } from '../wire.js';

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
  /** Workspace the module reported the project in (NXD-D09). */
  workspaceId: number;
  workspaceName: string;
  workspaceType: string;
}

export interface ListedNextoreWorkspace {
  id: number;
  name: string;
  type: string;
  /** False when this member could not read this workspace's project list. */
  readable: boolean;
  /** Deduped project ids that resolved into this workspace. */
  projectIds: string[];
}

function normalizeWorkspace(value: unknown): NextoreWorkspaceSummary | null {
  const id = wireNumber(value, 'id', 'Id');
  if (id === null || id === undefined) return null;
  return {
    id,
    name: wireString(value, 'name', 'Name')?.trim() ?? '',
    type: wireString(value, 'type', 'Type')?.trim() ?? '',
  };
}

function normalizeProject(value: unknown): NextoreProjectSummary | null {
  const id = wireNumber(value, 'id', 'Id');
  if (id === null || id === undefined) return null;
  return {
    id,
    name: wireString(value, 'name', 'Name')?.trim() ?? '',
    designerProjectId:
      wireString(value, 'designerProjectId', 'DesignerProjectId')?.trim() ?? '',
    designSystemId: wireString(value, 'designSystemId', 'DesignSystemId') ?? null,
    skillId: wireString(value, 'skillId', 'SkillId') ?? null,
    status: wireString(value, 'status', 'Status') ?? null,
  };
}

export interface NextoreProjectListing {
  projects: ListedNextoreProject[];
  /** Every visible workspace, in the order the module returned them. */
  workspaces: ListedNextoreWorkspace[];
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
 * orphan the module no longer vouches for. The workspace order the module
 * returned is preserved so the sidebar can group projects without a second
 * round trip.
 */
export async function listNextoreProjects(input: {
  client: NextoreClient;
  accessToken: string;
  localProjectIds: readonly string[];
}): Promise<NextoreProjectListing> {
  const workspacesResponse = await input.client.workspaces<unknown>(input.accessToken);
  const workspaces = wireArray(workspacesResponse, 'workspaces', 'Workspaces')
    .map(normalizeWorkspace)
    .filter((workspace): workspace is NextoreWorkspaceSummary => workspace !== null);

  const listedWorkspaces: ListedNextoreWorkspace[] = workspaces.map((workspace) => ({
    id: workspace.id,
    name: workspace.name?.trim() || '',
    type: workspace.type?.trim() || '',
    readable: true,
    projectIds: [],
  }));

  const summaries: Array<{
    summary: NextoreProjectSummary;
    workspace: ListedNextoreWorkspace;
  }> = [];
  for (const [index, workspace] of workspaces.entries()) {
    try {
      const response = await input.client.workspaceProjects<unknown>(
        input.accessToken,
        workspace.id,
      );
      const entry = listedWorkspaces[index]!;
      for (const summary of wireArray(response, 'projects', 'Projects')) {
        const normalized = normalizeProject(summary);
        if (normalized) summaries.push({ summary: normalized, workspace: entry });
      }
    } catch {
      // One workspace the member cannot read must not hide the others.
      listedWorkspaces[index]!.readable = false;
    }
  }

  const seen = new Set<string>();
  const localIds = new Set(input.localProjectIds);
  const projects: ListedNextoreProject[] = [];
  for (const { summary, workspace } of summaries) {
    const designerProjectId = summary.designerProjectId?.trim();
    if (!designerProjectId || seen.has(designerProjectId)) continue;
    seen.add(designerProjectId);
    workspace.projectIds.push(designerProjectId);
    projects.push({
      nextoreProjectId: String(summary.id),
      designerProjectId,
      name: summary.name,
      designSystemId: summary.designSystemId?.trim() || null,
      skillId: summary.skillId?.trim() || null,
      status: summary.status?.trim() || null,
      hasLocalContent: localIds.has(designerProjectId),
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      workspaceType: workspace.type,
    });
  }

  return {
    projects,
    workspaces: listedWorkspaces,
    remoteWithoutLocal: projects
      .filter((project) => !project.hasLocalContent)
      .map((project) => project.designerProjectId),
    localWithoutRemote: input.localProjectIds.filter((id) => !seen.has(id)),
  };
}
