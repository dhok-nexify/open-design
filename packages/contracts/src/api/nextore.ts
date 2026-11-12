/**
 * NexTore edition: workspaces and the member's own session view.
 *
 * These DTOs are shared by the daemon (which calls the NexTore Designer
 * module) and the web shell (which renders the workspace sidebar and the
 * team-workspace dialog). The module stays the authority for ACLs; the shapes
 * here only carry what the two surfaces need.
 */

/** The role presets a team workspace grant may use (NXD-D40). */
export type NextoreTeamWorkspaceRole = 'manager' | 'editor' | 'reader';

export const NEXTORE_TEAM_WORKSPACE_ROLES: readonly NextoreTeamWorkspaceRole[] = [
  'manager',
  'editor',
  'reader',
];

export function isNextoreTeamWorkspaceRole(value: unknown): value is NextoreTeamWorkspaceRole {
  return value === 'manager' || value === 'editor' || value === 'reader';
}

/** One group/role pair in a create-team-workspace request. */
export interface NextoreTeamWorkspaceGrant {
  groupId: number;
  role: NextoreTeamWorkspaceRole;
}

/** POST /api/nextore/workspaces body. */
export interface CreateNextoreTeamWorkspaceRequest {
  name: string;
  grants: NextoreTeamWorkspaceGrant[];
}

/** POST /api/nextore/workspaces response. */
export interface CreateNextoreTeamWorkspaceResponse {
  id: number;
  name: string;
  type: 'team';
}

/** One group of the signed-in member, as the module reports it on bootstrap. */
export interface NextoreSessionGroupSummary {
  id: number;
  name: string;
}

/** GET /api/nextore/groups response (DesignerAdmin only). */
export interface NextoreGroupsResponse {
  groups: NextoreSessionGroupSummary[];
}

/** GET /api/nextore/session response (the shell's own identity view). */
export interface NextoreSessionView {
  memberId: number;
  rights: {
    access: boolean;
    createProject: boolean;
    admin: boolean;
    manageMcp: boolean;
  };
  groups: NextoreSessionGroupSummary[];
}
