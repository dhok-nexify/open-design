import type {
  NextoreBrandingResponse,
  NextoreModuleHealthResponse,
} from '@open-design/contracts';
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
  /** Creates the DesignProject record for a local project (D08). */
  createProject<T>(accessToken: string, body: NextoreProjectCreateInput, signal?: AbortSignal): Promise<T>;
  /** Deletes the DesignProject record; 404 is a no-op for the caller. */
  deleteProject<T>(accessToken: string, projectId: string, signal?: AbortSignal): Promise<T>;
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

export function createNextoreClient(options: NextoreClientOptions): NextoreClient {
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
          `NexTore rejected ${path} with HTTP ${response.status}.`,
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

    bootstrap<T>(accessToken: string, signal?: AbortSignal) {
      return request<T>(
        '/api/designer/bootstrap',
        signal ? { accessToken, signal } : { accessToken },
      );
    },
  };
}
