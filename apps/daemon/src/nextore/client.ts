import type {
  CreateNextoreTeamWorkspaceRequest,
  NextoreArtifactPublishRequest,
  NextoreBrandingResponse,
  NextoreModuleHealthResponse,
  NextoreTier,
  SaveNextoreProjectPermissionsRequest,
} from '@open-design/contracts';
import { openAsBlob } from 'node:fs';
import type { NextoreConfig } from './config.js';

const DEFAULT_TIMEOUT_MS = 8_000;
type FetchLike = typeof fetch;

export class NextoreClientError extends Error {
  constructor(
    readonly code: 'nextore_timeout' | 'nextore_unreachable' | 'nextore_response_invalid' | 'nextore_http_error',
    message: string,
    readonly statusCode?: number,
    readonly upstreamCode?: string,
  ) {
    super(message);
    this.name = 'NextoreClientError';
  }
}

export interface NextoreProjectCreateInput {
  workspaceId: number;
  name: string;
  /** The daemon's project id; the module stores it for the reverse mapping. */
  designerProjectId: string;
  designSystemId?: string | null;
  skillId?: string | null;
  designerUrl?: string | null;
}

export interface NextoreClientOptions {
  config: NextoreConfig;
  fetch?: FetchLike;
  timeoutMs?: number;
}

interface RequestOptions {
  accessToken?: string;
  signal?: AbortSignal;
  method?: 'GET' | 'POST' | 'DELETE';
  body?: unknown;
}

export interface NextoreClient {
  health(signal?: AbortSignal): Promise<NextoreModuleHealthResponse>;
  branding(signal?: AbortSignal): Promise<NextoreBrandingResponse>;
  bootstrap<T>(accessToken: string, signal?: AbortSignal): Promise<T>;
  /**
   * OpenAI-shaped model list for one tier. The module answers 200 with an
   * empty `data` array when the tier has no model configured, 403 when the
   * caller may not use Designer, and 401 when the credential is rejected.
   * Only the self-test diagnostics call this; runs go through the provider
   * base URL instead.
   */
  tierModels<T>(accessToken: string, tier: NextoreTier, signal?: AbortSignal): Promise<T>;
  /** Effective rights for one DesignProject, as the module computes them. */
  projectAccess<T>(accessToken: string, projectId: string, signal?: AbortSignal): Promise<T>;
  /** Deep link into the site's permission editor for one DesignProject. */
  projectPermissionUrl<T>(
    accessToken: string,
    projectId: string,
    returnUrl?: string | null,
    signal?: AbortSignal,
  ): Promise<T>;
  /** The caller's workspaces, with the personal one created on first use (N06). */
  workspaces<T>(accessToken: string, signal?: AbortSignal): Promise<T>;
  /** Projects the caller can read in one workspace (D08 listing). */
  workspaceProjects<T>(accessToken: string, workspaceId: number, signal?: AbortSignal): Promise<T>;
  /** Platform groups for the team-workspace dialog (DesignerAdmin, NXD-D40). */
  groups<T>(accessToken: string, query?: string, signal?: AbortSignal): Promise<T>;
  /** Creates a team workspace with per-group role grants (NXD-D40). */
  createWorkspace<T>(
    accessToken: string,
    body: CreateNextoreTeamWorkspaceRequest,
    signal?: AbortSignal,
  ): Promise<T>;
  /** Creates the DesignProject record for a local project (D08). */
  createProject<T>(accessToken: string, body: NextoreProjectCreateInput, signal?: AbortSignal): Promise<T>;
  /** Deletes the DesignProject record; 404 is a no-op for the caller. */
  deleteProject<T>(accessToken: string, projectId: string, signal?: AbortSignal): Promise<T>;
}

/**
 * Permission methods implemented by the production client. Kept as an extension
 * interface so route tests and older mocks can still implement the base
 * NextoreClient surface without every new endpoint forcing a mock rewrite.
 */
export interface NextorePermissionClient {
  projectPermissions<T>(accessToken: string, projectId: string, signal?: AbortSignal): Promise<T>;
  saveProjectPermissions<T>(
    accessToken: string,
    projectId: string,
    body: SaveNextoreProjectPermissionsRequest,
    signal?: AbortSignal,
  ): Promise<T>;
  permissionGroups<T>(
    accessToken: string,
    projectId: string,
    query?: string,
    signal?: AbortSignal,
  ): Promise<T>;
  permissionMembers<T>(
    accessToken: string,
    projectId: string,
    query?: string,
    signal?: AbortSignal,
  ): Promise<T>;
}

/**
 * Artifact publication added in P04a. Kept as an extension interface for the
 * same reason as NextorePermissionClient: existing route mocks that only need
 * the base client must not be rewritten just because a new endpoint landed.
 */
export interface NextoreArtifactClient {
  publishArtifact<T>(
    accessToken: string,
    projectId: string,
    artifactId: string,
    metadata: NextoreArtifactPublishRequest,
    file: { path: string; name: string; mimeType: string },
    signal?: AbortSignal,
  ): Promise<T>;
}

function parseJson(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new NextoreClientError('nextore_response_invalid', 'NexTore returned malformed JSON.');
  }
}

function upstreamErrorCode(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const error = (payload as { error?: unknown }).error;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  const code = (payload as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

/**
 * The human sentence the module attached to a rejected call. The Designer client
 * shows this verbatim for a rejected create, so dropping it reduces every failure
 * to the transport-shaped fallback below.
 */
function upstreamErrorMessage(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const message = (payload as { message?: unknown }).message;
  if (typeof message === 'string' && message.trim()) return message.trim();
  const error = (payload as { error?: unknown }).error;
  if (error && typeof error === 'object') {
    const nested = (error as { message?: unknown }).message;
    if (typeof nested === 'string' && nested.trim()) return nested.trim();
  }
  return undefined;
}

export function createNextoreClient(
  options: NextoreClientOptions,
): NextoreClient & NextorePermissionClient & NextoreArtifactClient {
  const fetchImpl = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const configuredBase = new URL(options.config.baseUrl);

  async function request<T>(path: string, requestOptions: RequestOptions = {}): Promise<T> {
    const url = new URL(path, configuredBase);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = () => controller.abort();
    requestOptions.signal?.addEventListener('abort', onAbort, { once: true });

    const headers: Record<string, string> = { accept: 'application/json' };
    if (requestOptions.accessToken) headers.APIkey = requestOptions.accessToken;
    if (requestOptions.body !== undefined) headers['content-type'] = 'application/json';

    try {
      const response = await fetchImpl(url, {
        method: requestOptions.method ?? 'GET',
        headers,
        signal: controller.signal,
        ...(requestOptions.body !== undefined
          ? { body: JSON.stringify(requestOptions.body) }
          : {}),
      });
      const text = await response.text();
      const payload = parseJson(text);

      if (!response.ok) {
        const code = upstreamErrorCode(payload);
        throw new NextoreClientError(
          'nextore_http_error',
          upstreamErrorMessage(payload)
            ?? `NexTore rejected ${path} with HTTP ${response.status}.`,
          response.status,
          code,
        );
      }

      return payload as T;
    } catch (error) {
      if (error instanceof NextoreClientError) throw error;
      if (controller.signal.aborted) {
        throw new NextoreClientError('nextore_timeout', `NexTore request timed out after ${timeoutMs}ms.`);
      }
      throw new NextoreClientError(
        'nextore_unreachable',
        error instanceof Error ? `NexTore is unreachable: ${error.message}` : 'NexTore is unreachable.',
      );
    } finally {
      clearTimeout(timeout);
      requestOptions.signal?.removeEventListener('abort', onAbort);
    }
  }

  const uploadTimeoutMs = 600_000;

  async function requestMultipart<T>(
    path: string,
    form: FormData,
    accessToken: string,
    signal?: AbortSignal,
  ): Promise<T> {
    const url = new URL(path, configuredBase);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), uploadTimeoutMs);
    const onAbort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener('abort', onAbort, { once: true });

    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: { accept: 'application/json', APIkey: accessToken },
        body: form,
        signal: controller.signal,
      });
      const text = await response.text();
      const payload = parseJson(text);

      if (!response.ok) {
        const code = upstreamErrorCode(payload);
        throw new NextoreClientError(
          'nextore_http_error',
          upstreamErrorMessage(payload)
            ?? `NexTore rejected ${path} with HTTP ${response.status}.`,
          response.status,
          code,
        );
      }

      return payload as T;
    } catch (error) {
      if (error instanceof NextoreClientError) throw error;
      if (controller.signal.aborted) {
        throw new NextoreClientError(
          'nextore_timeout',
          `NexTore upload timed out after ${uploadTimeoutMs}ms.`,
        );
      }
      throw new NextoreClientError(
        'nextore_unreachable',
        error instanceof Error ? `NexTore is unreachable: ${error.message}` : 'NexTore is unreachable.',
      );
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  return {
    health(signal?: AbortSignal) {
      return request<NextoreModuleHealthResponse>(
        '/api/designer/health',
        signal ? { signal } : {},
      );
    },

    branding(signal?: AbortSignal) {
      return request<NextoreBrandingResponse>(
        '/api/designer/branding',
        signal ? { signal } : {},
      );
    },

    projectAccess<T>(accessToken: string, projectId: string, signal?: AbortSignal) {
      return request<T>(
        'api/designer/projects/' + encodeURIComponent(projectId) + '/access',
        signal ? { accessToken, signal } : { accessToken },
      );
    },

    projectPermissions<T>(accessToken: string, projectId: string, signal?: AbortSignal) {
      return request<T>(
        'api/designer/projects/' + encodeURIComponent(projectId) + '/permissions',
        signal ? { accessToken, signal } : { accessToken },
      );
    },

    saveProjectPermissions<T>(
      accessToken: string,
      projectId: string,
      body: SaveNextoreProjectPermissionsRequest,
      signal?: AbortSignal,
    ) {
      return request<T>('api/designer/projects/' + encodeURIComponent(projectId) + '/permissions', {
        accessToken,
        method: 'POST',
        body,
        ...(signal ? { signal } : {}),
      });
    },

    permissionGroups<T>(
      accessToken: string,
      projectId: string,
      query?: string,
      signal?: AbortSignal,
    ) {
      const suffix = query ? '?query=' + encodeURIComponent(query) : '';
      return request<T>(
        'api/designer/projects/' + encodeURIComponent(projectId) + '/permission-groups' + suffix,
        signal ? { accessToken, signal } : { accessToken },
      );
    },

    permissionMembers<T>(
      accessToken: string,
      projectId: string,
      query?: string,
      signal?: AbortSignal,
    ) {
      const suffix = query ? '?query=' + encodeURIComponent(query) : '';
      return request<T>(
        'api/designer/projects/' + encodeURIComponent(projectId) + '/permission-members' + suffix,
        signal ? { accessToken, signal } : { accessToken },
      );
    },

    projectPermissionUrl<T>(
      accessToken: string,
      projectId: string,
      returnUrl?: string | null,
      signal?: AbortSignal,
    ) {
      const query = returnUrl ? '?returnUrl=' + encodeURIComponent(returnUrl) : '';
      return request<T>(
        'api/designer/projects/' + encodeURIComponent(projectId) + '/permission-url' + query,
        signal ? { accessToken, signal } : { accessToken },
      );
    },

    workspaces<T>(accessToken: string, signal?: AbortSignal) {
      return request<T>(
        'api/designer/workspaces',
        signal ? { accessToken, signal } : { accessToken },
      );
    },

    workspaceProjects<T>(accessToken: string, workspaceId: number, signal?: AbortSignal) {
      return request<T>(
        'api/designer/workspaces/' + encodeURIComponent(String(workspaceId)) + '/projects',
        signal ? { accessToken, signal } : { accessToken },
      );
    },

    groups<T>(accessToken: string, query?: string, signal?: AbortSignal) {
      const suffix = query ? '?query=' + encodeURIComponent(query) : '';
      return request<T>(
        'api/designer/groups' + suffix,
        signal ? { accessToken, signal } : { accessToken },
      );
    },

    createWorkspace<T>(
      accessToken: string,
      body: CreateNextoreTeamWorkspaceRequest,
      signal?: AbortSignal,
    ) {
      return request<T>('api/designer/workspaces', {
        accessToken,
        method: 'POST',
        body,
        ...(signal ? { signal } : {}),
      });
    },

    createProject<T>(accessToken: string, body: NextoreProjectCreateInput, signal?: AbortSignal) {
      return request<T>('api/designer/projects', {
        accessToken,
        method: 'POST',
        body,
        ...(signal ? { signal } : {}),
      });
    },

    deleteProject<T>(accessToken: string, projectId: string, signal?: AbortSignal) {
      return request<T>(
        'api/designer/projects/' + encodeURIComponent(projectId),
        { accessToken, method: 'DELETE', ...(signal ? { signal } : {}) },
      );
    },

    async publishArtifact<T>(
      accessToken: string,
      projectId: string,
      artifactId: string,
      metadata: NextoreArtifactPublishRequest,
      file: { path: string; name: string; mimeType: string },
      signal?: AbortSignal,
    ) {
      const form = new FormData();
      form.append('metadata', JSON.stringify(metadata));
      const blob = await openAsBlob(file.path, { type: file.mimeType });
      form.append('file', blob, file.name);
      return requestMultipart<T>(
        'api/designer/projects/' + encodeURIComponent(projectId)
          + '/artifacts/' + encodeURIComponent(artifactId) + '/publish',
        form,
        accessToken,
        signal,
      );
    },

    tierModels<T>(accessToken: string, tier: NextoreTier, signal?: AbortSignal) {
      return request<T>(
        'api/designer/llm/' + encodeURIComponent(tier) + '/v1/models',
        signal ? { accessToken, signal } : { accessToken },
      );
    },

    bootstrap<T>(accessToken: string, signal?: AbortSignal) {
      return request<T>(
        '/api/designer/bootstrap',
        signal ? { accessToken, signal } : { accessToken },
      );
    },
  };
}
