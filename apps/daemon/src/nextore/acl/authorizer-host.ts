// NexTore project authorizer host.
//
// A project that carries a NexTore document mapping must also pass the module's
// ACL (NXD-D07). Projects without a mapping keep upstream behavior, so this only
// becomes enforcing once the mapping writer lands. Kept out of `startServer` so
// upstream changes around request authorization do not collide with this wiring.

import type { AuthorizeProjectRequest } from '../../collab/project-request-authority.js';
import { getProject } from '../../db.js';
import type { Edition } from '../../edition/index.js';
import { sendApiError } from '../../http/api-errors.js';
import type { NextoreClient } from '../client.js';
import type { NextoreConfig } from '../config.js';
import { hasValidShareGrant } from '../share/service.js';
import { normalizeAccess } from '../wire.js';
import { createProjectAccessCache } from './access-cache.js';
import { createNextoreProjectAuthorizer } from './authorize-project.js';

type ProjectDb = Parameters<typeof getProject>[0];

/** Reads the mapped NexTore project id from local project metadata. */
export function createProjectMappingReader(db: ProjectDb): (projectId: string) => string | null {
  return (projectId) => {
    try {
      const metadata = getProject(db, projectId)?.metadata as
        | { nextoreProjectId?: string }
        | null
        | undefined;
      return metadata?.nextoreProjectId?.trim() || null;
    } catch {
      return null;
    }
  };
}

export type NextoreProjectAuthorizerOptions = {
  edition: Edition;
  config: NextoreConfig | null;
  client: NextoreClient | null;
  db: ProjectDb;
  /** The upstream authorizer used when the edition has no client. */
  local: AuthorizeProjectRequest;
  readProjectMapping: (projectId: string) => string | null;
};

/**
 * Compose the project authorizer: upstream rules first, then the module ACL for
 * mapped projects.
 */
export function createProjectAuthorizer(
  options: NextoreProjectAuthorizerOptions,
): AuthorizeProjectRequest {
  const { edition, config, client, db, local, readProjectMapping } = options;
  const cache = client ? createProjectAccessCache() : null;
  if (!client || !config || !cache) return local;

  return createNextoreProjectAuthorizer(local, {
    edition,
    cache,
    load: async (accessToken, projectId) =>
      normalizeAccess(await client.projectAccess<unknown>(accessToken, projectId)),
    readSession: (res) => {
      const session = (res as {
        locals?: { nextoreSession?: { accessToken?: string; memberId?: number } };
      }).locals?.nextoreSession;
      return typeof session?.accessToken === 'string' && typeof session.memberId === 'number'
        ? { accessToken: session.accessToken, memberId: session.memberId }
        : null;
    },
    readProjectMapping,
    readShareGrant: (memberId, projectId) => hasValidShareGrant(db, memberId, projectId),
    // Denial codes cross this boundary as plain strings; the API helper narrows
    // them to its own union, exactly as the inline version did.
    deny: (res, status, code, message) =>
      sendApiError(res as never, status, code as Parameters<typeof sendApiError>[2], message),
  });
}
