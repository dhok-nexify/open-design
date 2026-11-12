import { NextoreClientError, type NextoreClient } from '../client.js';
import { wireArray, wireNumber, wireString } from '../wire.js';

export interface NextoreWorkspaceSummary {
  id: number;
  name: string;
  type: string;
  /** True when the caller reaches this workspace only through a shared project. */
  sharedOnly?: boolean;
  /** True when the caller may create a DesignProject in this workspace. */
  canCreateProject?: boolean;
}

export interface NextoreProjectDescriptor {
  id: string;
  name: string;
  designSystemId?: string | null;
  skillId?: string | null;
}

function readCanCreateProject(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const access = (value as { access?: unknown }).access ?? (value as { Access?: unknown }).Access;
  if (!access || typeof access !== 'object') return false;
  return (access as { canCreateProject?: unknown }).canCreateProject === true
    || (access as { CanCreateProject?: unknown }).CanCreateProject === true;
}

function normalizeWorkspace(value: unknown): NextoreWorkspaceSummary | null {
  const id = wireNumber(value, 'id', 'Id');
  if (id === null || id === undefined) return null;
  return {
    id,
    name: wireString(value, 'name', 'Name')?.trim() ?? '',
    type: wireString(value, 'type', 'Type')?.trim() ?? '',
    sharedOnly:
      (value as { sharedOnly?: unknown }).sharedOnly === true
      || (value as { SharedOnly?: unknown }).SharedOnly === true,
    canCreateProject: readCanCreateProject(value),
  };
}

export type RegisterProjectResult =
  | { ok: true; nextoreProjectId: string; workspaceId: number }
  | {
      ok: false;
      code: 'NO_WORKSPACE' | 'WORKSPACE_FORBIDDEN' | 'NEXTORE_ERROR' | 'PROJECT_NAME_CONFLICT';
      message: string;
    };

/**
 * Picks the workspace a new project belongs to (NXD-D08).
 *
 * A writable personal workspace is the default; when the caller names an
 * explicit workspace the registrar validates it instead of picking one.
 */
export function pickWorkspaceId(workspaces: readonly NextoreWorkspaceSummary[]): number | null {
  // Prefer a workspace the module says is writable; fall back to the full list
  // so a permission denial still comes back from the create call with a reason.
  const creatable = workspaces.filter((workspace) => workspace.canCreateProject !== false);
  const pool = creatable.length > 0 ? creatable : workspaces;
  const personal = pool.find((workspace) => workspace.type === 'personal');
  if (personal) return personal.id;
  return pool.length > 0 ? pool[0]!.id : null;
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
    const response = await input.client.workspaces<unknown>(input.accessToken);
    const workspaces = wireArray(response, 'workspaces', 'Workspaces')
      .map(normalizeWorkspace)
      .filter((workspace): workspace is NextoreWorkspaceSummary => workspace !== null);

    if (workspaceId == null) {
      workspaceId = pickWorkspaceId(workspaces);
    } else {
      // A caller-chosen workspace is only honoured when the module reports
      // CanCreateFolder for it; the same rule the create call enforces, but
      // checked first so a refusal is a 403 rather than a generic outage.
      const target = workspaces.find((workspace) => workspace.id === workspaceId);
      if (!target) {
        return {
          ok: false,
          code: 'NO_WORKSPACE',
          message: 'That workspace is not available to this member.',
        };
      }
      if (!target.canCreateProject) {
        return {
          ok: false,
          code: 'WORKSPACE_FORBIDDEN',
          message: 'You cannot create projects in that workspace.',
        };
      }
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
    // distinction so the create route can answer 409 instead of 503. A 403 is
    // the module refusing DesignerCreateProject or workspace CanCreateFolder,
    // which is a permission answer, not an outage.
    const upstreamCode = error instanceof NextoreClientError ? error.upstreamCode : undefined;
    const forbidden = error instanceof NextoreClientError && error.statusCode === 403;
    return {
      ok: false,
      code: upstreamCode === 'project_name_conflict'
        ? 'PROJECT_NAME_CONFLICT'
        : forbidden
          ? 'WORKSPACE_FORBIDDEN'
          : 'NEXTORE_ERROR',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
