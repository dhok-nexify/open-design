import { isNextoreTier, type ByokChatProviderConfig, type NextoreTier } from '@open-design/contracts';

import type { NextoreSession } from '../auth/session-store.js';
import type { NextoreConfig } from '../config.js';

/**
 * The provider a NexTore edition run must use (NXD-D13, P12).
 *
 * The client only names a model from the platform catalog (`fast`, `expert` or
 * `model:<treeObjectId>`). The daemon resolves that name to a module endpoint
 * and the signed-in session supplies the credential. A client can never supply
 * an arbitrary base URL, API key or upstream model string.
 */
export interface NextoreRunProviderInput {
  config: NextoreConfig;
  session: Pick<NextoreSession, 'accessToken'> | null | undefined;
  tier: unknown;
  modelKey?: string | null;
}

export type NextoreRunProvider =
  | {
      ok: true;
      tier: NextoreTier;
      model: string;
      modelKey: string;
      byokProvider: ByokChatProviderConfig;
    }
  | {
      ok: false;
      status: 400 | 401;
      code: 'TIER_INVALID' | 'MODEL_KEY_INVALID' | 'SESSION_REQUIRED';
      message: string;
    };

/** Path the module exposes for a tier (NXD-N08). */
export function nextoreTierBaseUrl(baseUrl: string, tier: NextoreTier): string {
  return baseUrl.replace(/\/+$/, '') + '/api/designer/llm/' + tier + '/v1';
}

export function resolveNextoreRunProvider(input: NextoreRunProviderInput): NextoreRunProvider {
  const requested = parseModelKey(input.modelKey);
  if (requested.invalid) {
    return {
      ok: false,
      status: 400,
      code: 'MODEL_KEY_INVALID',
      message: 'modelKey must be "fast", "expert" or "model:<treeObjectId>".',
    };
  }
  const tier = requested.tier ?? normalizeNextoreTier(input.tier as string | null | undefined);
  if (!tier) {
    return {
      ok: false,
      status: 400,
      code: 'TIER_INVALID',
      message: 'tier must be "fast" or "expert".',
    };
  }

  const accessToken = input.session?.accessToken?.trim();
  if (!accessToken) {
    return {
      ok: false,
      status: 401,
      code: 'SESSION_REQUIRED',
      message: 'A NexTore session is required to start a run.',
    };
  }

  const modelKey = requested.key ?? tier;
  const baseUrl = requested.modelId
    ? input.config.baseUrl.replace(/\/+$/, '') + '/api/designer/llm/models/' + requested.modelId + '/v1'
    : nextoreTierBaseUrl(input.config.baseUrl, tier);

  return {
    ok: true,
    tier,
    // The OpenAI client still needs a model string; use the catalog key so
    // diagnostics record what the user actually selected.
    model: modelKey,
    modelKey,
    byokProvider: {
      protocol: 'openai',
      apiKey: accessToken,
      baseUrl,
    },
  };
}

type ParsedModelKey = {
  invalid?: false;
  key: string | null;
  tier: NextoreTier | null;
  modelId: string | null;
} | {
  invalid: true;
};

function parseModelKey(value: string | null | undefined): ParsedModelKey {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return { key: null, tier: null, modelId: null };
  if (isNextoreTier(raw)) return { key: raw, tier: raw, modelId: null };
  const match = /^model:(\d+)$/.exec(raw);
  if (!match) return { invalid: true };
  return { key: raw, tier: null, modelId: match[1] ?? '' };
}

/**
 * D40: model aliases collapse onto the existing tier axis instead of a second
 * mapping table. `small_model` is the cost-sensitive alias and therefore
 * resolves to the cheap `fast` tier; everything else must be a real tier.
 */
const TIER_ALIASES: Readonly<Record<string, NextoreTier>> = { small_model: 'fast' };

export function normalizeNextoreTier(value: string | null | undefined): NextoreTier | null {
  if (value === null || value === undefined || value === '') return 'expert';
  const alias = TIER_ALIASES[value.trim().toLowerCase()];
  if (alias) return alias;
  return isNextoreTier(value) ? value : null;
}
