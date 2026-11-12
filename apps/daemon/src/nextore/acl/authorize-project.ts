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
  /**
   * A live share grant for (member, local project), or false when the member
   * has none / the link was revoked or expired (NXD-D20). Share grants only
   * cover read and comment; every other capability still needs module ACL.
   */
  readShareGrant?: (memberId: number, localProjectId: string) => boolean;
  deny: (res: unknown, status: number, code: string, message: string) => void;
}

/**
 * A share grant is deliberately narrow: it substitutes for the module ACL only
 * on the read/comment surfaces. Conversation history, downloads and sharing
 * the project onward still require the member's own NexTore rights.
 */
function shareGrantCovers(options: AuthorizeProjectRequestOptions): boolean {
  if (options.mode === 'write') return options.capability === 'comment';
  if (options.capability === 'download' || options.capability === 'share') return false;
  return options.readKind !== 'conversation';
}

function requiredRight(
  access: NextoreProjectAccess,
  options: AuthorizeProjectRequestOptions,
): boolean {
  if (options.mode === 'read') {
    // Export/download hands the caller the project's bytes, so it follows the
    // module's download right (share: the right to hand them to someone else).
    if (options.capability === 'download') return access.canDownload;
    if (options.capability === 'share') return access.canManage;
    // Conversation surfaces are stricter than content reads: Q34 says only a
    // member who may edit the project may read its history or run streams.
    return options.readKind === 'conversation' ? access.canEdit : access.canRead;
  }
  switch (options.capability) {
    // Annotating is the promise the read-only banner makes ("view and
    // comment"), so a reader may comment; editing someone else's note is
    // enforced per comment by authorship, not here.
    case 'comment':
      return access.canRead;
    case 'delete':
      return access.canDelete;
    case 'download':
      return access.canDownload;
    case 'share':
      return access.canManage;
    default:
      return access.canEdit;
  }
}

/**
 * Wraps the local project authorizer with the NexTore ACL (NXD-D07).
 *
 * Order matters: the local gate runs first so workspace placeholders, revoked
 * mirrors and imported projects keep exactly today's semantics. The NexTore
 * module then decides every project it owns, and a project WITHOUT a mapping is
 * refused outright (T-D21). The local gate has no member model in this edition,
 * so falling through to it would hand every signed-in member full rights over
 * any project whose mapping went missing — which is reachable in practice, not
 * only theoretical: `nextoreProjectId` lives in project metadata, and a patch
 * that rebuilds metadata without it leaves a project holding real files but no
 * ACL to consult. Refusing is the only fail-safe answer.
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
    if (!nextoreProjectId) {
      deps.deny(
        res,
        404,
        'PROJECT_NOT_MAPPED',
        'This project is not registered with NexTore, so its permissions cannot be checked.',
      );
      return false;
    }

    const session = deps.readSession(res);
    if (!session) {
      deps.deny(res, 401, 'SESSION_REQUIRED', 'A NexTore session is required.');
      return false;
    }

    // NXD-D20: a redeemed share link is the authority for read + comment on
    // exactly this project, even when the member has no NexTore ACL on it.
    if (
      shareGrantCovers(options)
      && deps.readShareGrant?.(session.memberId, projectId)
    ) {
      return true;
    }

    const loadAccess = () => deps.load(session.accessToken, nextoreProjectId);
    let access: NextoreProjectAccess;
    try {
      // Writes must see the current ACL: a cached answer could let a
      // revocation through for up to the TTL. Reads keep the cache.
      access = options.mode === 'write'
        ? await loadAccess()
        : await deps.cache.read(session.memberId + ':' + nextoreProjectId, loadAccess);
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
