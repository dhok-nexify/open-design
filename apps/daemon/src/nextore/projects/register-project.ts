import { NextoreClientError, type NextoreClient } from '../client.js';
import { wireArray, wireNumber, wireString } from '../wire.js';

export interface NextoreWorkspaceSummary {
  id: number;
  name: string;
  type: string;
}

export interface NextoreProjectDescriptor {
  id: string;
  name: string;
  designSystemId?: string | null;
  skillId?: string | null;
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

export type RegisterProjectResult =
  | { ok: true; nextoreProjectId: string; workspaceId: number }
  | { ok: false; code: 'NO_WORKSPACE' | 'NEXTORE_ERROR' | 'PROJECT_NAME_CONFLICT'; message: string };

/**
 * Picks the workspace a new project belongs to (NXD-D08).
 *
 * The module guarantees a personal workspace exists on first read (N06), so the
 * personal one is the default; a caller that already knows a workspace id can
 * pass it and skip the lookup entirely.
 */
export function pickWorkspaceId(workspaces: readonly NextoreWorkspaceSummary[]): number | null {
  const personal = workspaces.find((workspace) => workspace.type === 'personal');
  if (personal) return personal.id;
  return workspaces.length > 0 ? workspaces[0]!.id : null;
}

/**
 * Creates the NexTore DesignProject record for a local project.
 *
 * `designerProjectId` is the local id, so the two records can always be matched
 * again without an extra table. The function does no local writes: the caller
 * decides whether a failure should roll the local project back.
 */
export async function registerNextoreProject(input: {
  client: NextoreClient;
  accessToken: string;
  project: NextoreProjectDescriptor;
  workspaceId?: number | null;
  designerUrl?: string | null;
}): Promise<RegisterProjectResult> {
  let workspaceId = input.workspaceId ?? null;
  try {
    if (workspaceId == null) {
      const response = await input.client.workspaces<unknown>(input.accessToken);
      workspaceId = pickWorkspaceId(
        wireArray(response, 'workspaces', 'Workspaces')
          .map(normalizeWorkspace)
          .filter((workspace): workspace is NextoreWorkspaceSummary => workspace !== null),
      );
    }
    if (workspaceId == null) {
      return {
        ok: false,
        code: 'NO_WORKSPACE',
        message: 'NexTore did not return a workspace this member can create a project in.',
      };
    }

    const created = await input.client.createProject<unknown>(input.accessToken, {
      workspaceId,
      name: input.project.name,
      designerProjectId: input.project.id,
      designSystemId: input.project.designSystemId ?? null,
      skillId: input.project.skillId ?? null,
      designerUrl: input.designerUrl ?? null,
    });
    const id = wireNumber(created, 'id', 'Id') ?? wireString(created, 'id', 'Id');
    if (typeof id !== 'number' && typeof id !== 'string') {
      return {
        ok: false,
        code: 'NEXTORE_ERROR',
        message: 'NexTore created the project but returned no id.',
      };
    }
    return { ok: true, nextoreProjectId: String(id), workspaceId };
  } catch (error) {
    // A taken project name is a user-fixable conflict, not an outage. Keep the
    // distinction so the create route can answer 409 instead of 503.
    const upstreamCode = error instanceof NextoreClientError ? error.upstreamCode : undefined;
    return {
      ok: false,
      code: upstreamCode === 'project_name_conflict' ? 'PROJECT_NAME_CONFLICT' : 'NEXTORE_ERROR',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
