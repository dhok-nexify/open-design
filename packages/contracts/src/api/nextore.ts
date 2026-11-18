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
  /** True when more groups matched than the response carries. */
  truncated?: boolean;
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

/** Which ACL record a permission row points at. */
export type NextorePermissionRecordType = 'owner' | 'group' | 'member';

/** The eight ACL flags the native permission page exposes. */
export interface NextoreProjectPermissionRights {
  manage: boolean;
  read: boolean;
  edit: boolean;
  delete: boolean;
  download: boolean;
  checkOut: boolean;
  createFile: boolean;
  createFolder: boolean;
}

/** One row of the project permission matrix. */
export interface NextoreProjectPermissionItem {
  recordId: number;
  recordType: NextorePermissionRecordType;
  name: string;
  inherited: boolean;
  rights: NextoreProjectPermissionRights;
}

/** GET /api/projects/:id/permissions response. */
export interface NextoreProjectPermissions {
  exists: boolean;
  canManage: boolean;
  isInherit: boolean;
  customized: NextoreProjectPermissionItem[];
  inherited: NextoreProjectPermissionItem[];
}

/** One row posted to the project permission save endpoint. */
export interface NextoreProjectPermissionItemInput {
  recordType: NextorePermissionRecordType;
  recordId: number;
  rights: NextoreProjectPermissionRights;
}

/** POST /api/projects/:id/permissions body. */
export interface SaveNextoreProjectPermissionsRequest {
  isInherit: boolean;
  applyToAllChildren: boolean;
  items: NextoreProjectPermissionItemInput[];
}

/** One node of the group picker tree. */
export interface NextorePermissionGroup {
  id: number;
  name: string;
  parentId: number;
}

/** GET /api/projects/:id/permission-groups response. */
export interface NextorePermissionGroupsResponse {
  groups: NextorePermissionGroup[];
  truncated?: boolean;
}

/** One member returned by the permission member search. */
export interface NextorePermissionMember {
  id: number;
  login: string;
  fullName: string;
  email: string;
}

/** GET /api/projects/:id/permission-members response. */
export interface NextorePermissionMembersResponse {
  members: NextorePermissionMember[];
}
