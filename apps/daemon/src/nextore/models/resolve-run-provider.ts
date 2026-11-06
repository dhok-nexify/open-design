import { isNextoreTier, type ByokChatProviderConfig, type NextoreTier } from '@open-design/contracts';

import type { NextoreSession } from '../auth/session-store.js';
import type { NextoreConfig } from '../config.js';

/**
 * The provider a NexTore edition run must use (NXD-D13).
 *
 * The client never supplies a model id, base URL or credential in the edition:
 * the tier picks a module endpoint, and the signed-in session supplies the API
 * key. That keeps the token out of the browser and out of the prompt, and it
 * means a client cannot point the run at an arbitrary upstream.
 */
export interface NextoreRunProviderInput {
  config: NextoreConfig;
  session: Pick<NextoreSession, 'accessToken'> | null | undefined;
  tier: unknown;
}

export type NextoreRunProvider =
  | {
      ok: true;
      tier: NextoreTier;
      model: string;
      byokProvider: ByokChatProviderConfig;
    }
  | {
      ok: false;
      status: 400 | 401;
      code: 'TIER_INVALID' | 'SESSION_REQUIRED';
      message: string;
    };

/** Path the module exposes for a tier (NXD-N08). */
export function nextoreTierBaseUrl(baseUrl: string, tier: NextoreTier): string {
  return baseUrl.replace(/\/+$/, '') + '/api/designer/llm/' + tier + '/v1';
}

export function resolveNextoreRunProvider(input: NextoreRunProviderInput): NextoreRunProvider {
  const tier = input.tier == null || input.tier === '' ? 'expert' : input.tier;
  if (!isNextoreTier(tier)) {
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

  return {
    ok: true,
    tier,
    // The module resolves the tier to the configured model; the OpenAI client
    // still needs a model string, so the tier name is the honest value.
    model: tier,
    byokProvider: {
      protocol: 'openai',
      apiKey: accessToken,
      baseUrl: nextoreTierBaseUrl(input.config.baseUrl, tier),
    },
  };
}
