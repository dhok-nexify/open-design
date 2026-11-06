import type { Edition } from '@open-design/contracts';

import type {
  AuthorizeProjectRequest,
  AuthorizeProjectRequestOptions,
} from '../../collab/project-request-authority.js';
import type { NextoreProjectAccess, ProjectAccessCache } from './access-cache.js';

export interface NextoreSessionView {
  accessToken: string;
  memberId: number;
}

export interface NextoreProjectAuthorizerDeps {
  edition: Edition;
  cache: ProjectAccessCache;
  /** Module call: effective rights for one DesignProject id. */
  load: (accessToken: string, nextoreProjectId: string) => Promise<NextoreProjectAccess>;
  /** The signed-in session attached by the edition gate, if any. */
  readSession: (res: unknown) => NextoreSessionView | null;
  /** The NexTore project id a local project maps to, or null when unmapped. */
  readProjectMapping: (localProjectId: string) => string | null;
  deny: (res: unknown, status: number, code: string, message: string) => void;
}

function requiredRight(
  access: NextoreProjectAccess,
  options: AuthorizeProjectRequestOptions,
): boolean {
  if (options.mode === 'read') return access.canRead;
  switch (options.capability) {
    case 'delete':
      return access.canDelete;
    default:
      return access.canEdit;
  }
}

/**
 * Wraps the local project authorizer with the NexTore ACL (NXD-D07).
 *
 * Order matters: the local gate runs first so workspace placeholders, revoked
 * mirrors and imported projects keep exactly today's semantics. Only when a
 * project carries a NexTore mapping does the module get consulted. A project
 * without a mapping is a pre-D08 local project and stays allowed, which keeps
 * an existing deployment working while D08 fills the mapping in.
 *
 * A mapped project whose access cannot be resolved is denied with 503: the
 * module is the authority, and guessing would be worse than failing.
 */
export function createNextoreProjectAuthorizer(
  local: AuthorizeProjectRequest,
  deps: NextoreProjectAuthorizerDeps,
): AuthorizeProjectRequest {
  return async (req, res, projectId, options) => {
    const localAllowed = await local(req, res, projectId, options);
    if (!localAllowed) return false;
    if (deps.edition !== 'nextore') return true;

    const nextoreProjectId = deps.readProjectMapping(projectId);
    if (!nextoreProjectId) return true;

    const session = deps.readSession(res);
    if (!session) {
      deps.deny(res, 401, 'SESSION_REQUIRED', 'A NexTore session is required.');
      return false;
    }

    let access: NextoreProjectAccess;
    try {
      access = await deps.cache.read(
        session.memberId + ':' + nextoreProjectId,
        () => deps.load(session.accessToken, nextoreProjectId),
      );
    } catch {
      deps.deny(
        res,
        503,
        'NEXTORE_UNAVAILABLE',
        'NexTore could not confirm access to this project. Try again.',
      );
      return false;
    }

    if (!access.exists) {
      deps.deny(res, 404, 'PROJECT_NOT_FOUND', 'Project not found.');
      return false;
    }
    if (!requiredRight(access, options)) {
      deps.deny(res, 403, 'PROJECT_FORBIDDEN', 'You do not have access to this project.');
      return false;
    }
    return true;
  };
}
