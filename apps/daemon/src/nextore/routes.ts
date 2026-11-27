import { existsSync } from 'node:fs';
import type { Express, RequestHandler, Response } from 'express';
import {
  NEXTORE_TIERS,
  type NextoreSelfTestCheck,
  type NextoreSelfTestResponse,
  type NextoreTier,
  type NextoreTierModelsResponse,
} from '@open-design/contracts';
import {
  NEXTORE_MODULE_CONTRACT_VERSION,
  NextoreClientError,
  type NextoreClient,
} from './client.js';
import { createBrandingCache, type BrandingCache } from './branding-cache.js';
import { resolveChromiumExecutable } from './artifacts/snapshot-renderer.js';
import { registerBrandingSource } from './branding-state.js';

export interface RegisterNextoreRoutesDeps {
  client: NextoreClient;
  brandingCache?: BrandingCache;
}

function failedCheck(error: unknown): NextoreSelfTestCheck {
  if (error instanceof NextoreClientError) {
    return {
      status: 'unavailable',
      // The upstream code is what an operator acts on (for example
      // designer_access_required). The raw module sentence can carry
      // internals, and this endpoint is reachable anonymously.
      code: error.upstreamCode ?? error.code,
      ...(error.statusCode === undefined ? {} : { statusCode: error.statusCode }),
    };
  }
  return { status: 'unavailable', code: 'nextore_request_failed' };
}

export function nextoreHealthMetadata(
  edition: 'upstream' | 'nextore',
  version: unknown,
  oauthClientId?: string,
) {
  if (edition !== 'nextore') return {};
  return {
    edition,
    compat: {
      module: '>=1.0 <2',
    },
    // ND-R11-04: the module settings row and this environment value are two places that must
    // agree, and a silent divergence is invisible because sign-in keeps working either way.
    // Publishing the value the host actually signs in with makes the comparison one HTTP call;
    // a client id is public - it already appears in the authorize URL.
    ...(oauthClientId ? { oauthClientId } : {}),
    version,
  };
}

interface SelfTestSessionView {
  accessToken?: string;
}

type SelfTestSessionLookup = 'ok' | 'signed_out' | 'unavailable';

function pendingSessionCheck(): NextoreSelfTestCheck {
  return {
    status: 'pending_session',
    code: 'session_required',
    message: 'Sign in through NexTore to check authentication and models.',
  };
}

function unavailableSessionCheck(): NextoreSelfTestCheck {
  return {
    status: 'unavailable',
    code: 'session_unavailable',
    message: 'NexTore could not confirm the session; try again shortly.',
  };
}

function readSession(res: Response): SelfTestSessionView | null {
  const session = (res.locals as { nextoreSession?: SelfTestSessionView }).nextoreSession;
  if (!session || typeof session.accessToken !== 'string' || !session.accessToken.trim()) {
    return null;
  }
  return session;
}

function readLookup(res: Response): SelfTestSessionLookup | undefined {
  const value = (res.locals as { nextoreSessionLookup?: unknown }).nextoreSessionLookup;
  return value === 'ok' || value === 'signed_out' || value === 'unavailable' ? value : undefined;
}

/**
 * Health plus the contract manifest. A reachable module that speaks an older or
 * newer wire contract is a half-deployed pair: every cross-repo feature would
 * fail on a field the other side does not send, so the self-test fails here
 * instead of letting the next QA round find it in a feature log.
 */
async function probeModule(client: NextoreClient): Promise<NextoreSelfTestCheck> {
  try {
    await client.health();
  } catch (error) {
    return failedCheck(error);
  }
  try {
    const contract = await client.contract();
    if (contract && contract.contractVersion === NEXTORE_MODULE_CONTRACT_VERSION) {
      return { status: 'ok' };
    }
    return {
      status: 'unavailable',
      code: 'module_contract_mismatch',
      message: 'The module contract version does not match this Designer build.',
    };
  } catch (error) {
    if (error instanceof NextoreClientError && error.statusCode === 404) {
      return {
        status: 'unavailable',
        code: 'module_contract_missing',
        message: 'The module does not publish a contract manifest; update the module.',
      };
    }
    return failedCheck(error);
  }
}

/**
 * A resolved session is already proof: the gate rejected expired credentials,
 * renewed them when due, revalidated the member on schedule, and dropped
 * revoked rows before this handler ran. Calling bootstrap again would repeat
 * work without proving anything the gate did not.
 */
function authenticationCheck(res: Response): NextoreSelfTestCheck {
  if (readSession(res)) return { status: 'ok' };
  if (readLookup(res) === 'unavailable') return unavailableSessionCheck();
  return pendingSessionCheck();
}

async function probeTier(
  client: NextoreClient,
  accessToken: string,
  tier: NextoreTier,
): Promise<NextoreSelfTestCheck> {
  try {
    const body = await client.tierModels<NextoreTierModelsResponse>(accessToken, tier);
    if (!body || !Array.isArray(body.data)) {
      return { status: 'unavailable', code: 'nextore_response_invalid' };
    }
    if (body.data.length === 0) {
      return {
        status: 'unavailable',
        code: 'tier_not_configured',
        message: 'The ' + tier + ' model tier has no model configured.',
      };
    }
    return { status: 'ok' };
  } catch (error) {
    return failedCheck(error);
  }
}

/**
 * The models route proves what the run path needs before a run exists: the
 * session credential is accepted as an API key, DesignerAccess is granted,
 * and the tier resolves to a configured model. It deliberately does not send
 * a chat completion, so the probe spends no tokens and stays deterministic.
 */
async function probeLlm(
  client: NextoreClient,
  session: SelfTestSessionView | null,
  authentication: NextoreSelfTestCheck,
): Promise<NextoreSelfTestResponse['checks']['llm']> {
  const accessToken = session?.accessToken?.trim();
  if (!accessToken) {
    // A session the gate could not confirm never reached the probe; repeat
    // that reason instead of claiming no session exists.
    return authentication.status === 'unavailable' ? authentication : pendingSessionCheck();
  }

  const [fast, expert] = await Promise.all([
    probeTier(client, accessToken, 'fast'),
    probeTier(client, accessToken, 'expert'),
  ]);
  const tiers = { fast, expert };
  const failing = NEXTORE_TIERS.filter((tier) => tiers[tier].status !== 'ok');
  const firstTier = failing[0];
  if (!firstTier) return { status: 'ok', tiers };

  const first = tiers[firstTier];
  return {
    status: 'unavailable',
    ...(first.code === undefined ? {} : { code: first.code }),
    ...(first.statusCode === undefined ? {} : { statusCode: first.statusCode }),
    message: failing.length === 1
      ? 'The ' + firstTier + ' model tier is unavailable.'
      : 'Both model tiers are unavailable.',
    tiers,
  };
}

export function createNextoreSelfTestHandler(
  client: NextoreClient,
): RequestHandler {
  return async (_req, res: Response) => {
    const session = readSession(res);
    const authentication = authenticationCheck(res);

    const [module, branding, llm] = await Promise.all([
      probeModule(client),
      client.branding().then(
        () => ({ status: 'ok' }) as NextoreSelfTestCheck,
        (error: unknown) => failedCheck(error),
      ),
      probeLlm(client, session, authentication),
    ]);

    const checks: NextoreSelfTestResponse['checks'] = { module, branding, authentication, llm };
    const response: NextoreSelfTestResponse = {
      // Pending checks mean "not run", not "failed": only an executed probe
      // can turn the overall verdict false.
      ok: Object.values(checks).every((check) => check.status !== 'unavailable'),
      edition: 'nextore',
      checks,
    };

    res.setHeader('Cache-Control', 'no-store');
    res.json(response);
  };
}

export function registerNextoreRoutes(
  app: Express,
  deps: RegisterNextoreRoutesDeps,
): void {
  app.get('/api/nextore/self-test', createNextoreSelfTestHandler(deps.client));

  /**
   * Models the current user may select. Presets stay first; concrete entries
   * come from the platform catalog and never carry endpoint or key material.
   */
  app.get('/api/designer/models', async (_req, res) => {
    const session = res.locals as {
      nextoreSession?: { accessToken?: string; member?: { id?: number } };
    };
    const accessToken = session.nextoreSession?.accessToken?.trim();
    if (!accessToken) {
      res.status(401).json({ error: 'SESSION_REQUIRED' });
      return;
    }
    const presets = [
      { modelKey: 'fast', name: 'Fast', source: 'preset', capabilities: [] as string[] },
      { modelKey: 'expert', name: 'Expert', source: 'preset', capabilities: [] as string[] },
    ];
    if (!deps.client.readableModels) {
      res.status(502).json({ error: 'model_catalog_unavailable' });
      return;
    }
    try {
      const upstream = await deps.client.readableModels<{
        data?: Array<{ id?: string | number; owned_by?: string }>;
      }>(accessToken);
      const models = (upstream.data ?? [])
        .map((entry) => {
          const id = entry.id === undefined || entry.id === null ? '' : String(entry.id).trim();
          if (!/^\d+$/.test(id)) return null;
          return {
            modelKey: 'model:' + id,
            name: id,
            source: entry.owned_by === 'custom' ? 'custom' : 'standard',
            capabilities: [] as string[],
          };
        })
        .filter((entry): entry is {
          modelKey: string;
          name: string;
          source: string;
          capabilities: string[];
        } => entry !== null);
      res.json({ models: [...presets, ...models] });
    } catch (error) {
      const code = error instanceof NextoreClientError ? error.upstreamCode ?? error.code : undefined;
      res.status(502).json({
        error: 'model_catalog_unavailable',
        ...(code ? { upstreamCode: code } : {}),
      });
    }
  });

  /**
   * Renderer diagnostics: which Chromium the daemon would run, and whether the
   * deb-first resolver is deployed. Exists because a stale daemon build and a
   * snap-only PATH look identical from the outside ("chromium exited 46").
   */
  app.get('/api/nextore/renderer', (req, res) => {
    const session = (res.locals as { nextoreSession?: { memberId?: unknown } }).nextoreSession;
    if (typeof session?.memberId !== 'number') {
      res.status(401).json({ error: 'SESSION_REQUIRED' });
      return;
    }
    const candidates = [
      '/usr/bin/google-chrome-stable',
      '/opt/google/chrome/chrome',
      '/usr/bin/google-chrome',
      '/usr/bin/chromium',
      '/snap/bin/chromium',
    ];
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      resolver: 'deb-first-v2',
      resolved: resolveChromiumExecutable(),
      configured: process.env.OD_CHROMIUM_PATH?.trim() || null,
      noSandbox: process.env.OD_CHROMIUM_NO_SANDBOX === '1',
      candidates: Object.fromEntries(candidates.map((path) => [path, existsSync(path)])),
      pathChromium: process.env.PATH?.split(':').some((dir) => dir === '/snap/bin') ?? false,
    });
  });

  // Public, cached brand payload for the Designer shell (DESIGN §12.1). The module endpoint is
  // already anonymous; the daemon caches it so every boot does not round-trip to NexTore.
  const brandingCache = deps.brandingCache ?? createBrandingCache(deps.client);
  // Prompt composition reads the same cache, so a renamed installation reaches
  // agent-facing text on the same one-minute refresh as the shell (DESIGN §12.1).
  registerBrandingSource(brandingCache);
  app.get('/api/branding', async (req, res: Response) => {
    const snapshot = await brandingCache.get();
    if (!snapshot) {
      res.status(503).json({ error: 'branding_unavailable' });
      return;
    }

    const etag = 'W/"' + snapshot.value.version + '"';
    // Revalidate instead of trusting a browser cache: the body is
    // tiny and an unchanged brand still costs only a 304, while a saved brand
    // change shows up on the next page load rather than minutes later.
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('ETag', etag);
    if (snapshot.stale) res.setHeader('X-Branding-Stale', '1');

    const ifNoneMatch = req.headers['if-none-match'];
    if (typeof ifNoneMatch === 'string' && ifNoneMatch.split(',').some((value) => value.trim() === etag)) {
      res.status(304).end();
      return;
    }

    res.json(snapshot.value);
  });
}
