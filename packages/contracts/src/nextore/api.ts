import type { Edition } from './edition.js';

export const NEXTORE_MODULE_COMPATIBILITY = '>=1.0 <2';

/**
 * The two model tiers a run may ask for. The module resolves the tier to the
 * model configured in its settings, so the daemon never names a model id.
 */
export type NextoreTier = 'fast' | 'expert';

export const NEXTORE_TIERS: readonly NextoreTier[] = ['fast', 'expert'];

export function isNextoreTier(value: unknown): value is NextoreTier {
  return value === 'fast' || value === 'expert';
}

export interface DesignerHealthResponse {
  edition: Edition;
  version: unknown;
  compat: {
    module: string;
  };
}

export interface NextoreModuleHealthResponse {
  moduleVersion: string;
  compat?: {
    designer?: string;
  };
}

export interface NextoreBrandingResponse {
  siteTitle: string;
  brandName: string;
  logoLight?: string | null;
  logoDark?: string | null;
  favicon?: string | null;
  primaryColor: string;
  loadingText?: string | null;
  version: number;
}

/**
 * Outcome of one diagnostic probe.
 *
 * `pending_session` means the probe did not run because no NexTore session
 * reached the daemon. It is not a failure, so it never turns `ok` false; a
 * deployment smoke test that calls this anonymously keeps the previous answer.
 */
export type NextoreSelfTestStatus = 'ok' | 'unavailable' | 'pending_session';

export interface NextoreSelfTestCheck {
  status: NextoreSelfTestStatus;
  /**
   * Lower-snake reason, stable across releases. Passed through from
   * `NextoreClientError.code`, the module's own error code (for example
   * `designer_access_required`), or a diagnostic code defined by the daemon.
   */
  code?: string;
  /** Upstream HTTP status when the failure came from a module response. */
  statusCode?: number;
  message?: string;
}

/**
 * The OpenAI-shaped model list the module returns for one tier. An empty
 * `data` array means the administrator has not configured that tier yet, which
 * is the module's documented way of advertising nothing.
 */
export interface NextoreTierModelsResponse {
  object: 'list';
  data: Array<{ id: string; object?: string; created?: number; owned_by?: string }>;
}

export interface NextoreSelfTestResponse {
  ok: boolean;
  edition: 'nextore';
  checks: {
    module: NextoreSelfTestCheck;
    branding: NextoreSelfTestCheck;
    authentication: NextoreSelfTestCheck;
    /** `tiers` carries per-tier detail so a caller can tell which tier fails. */
    llm: NextoreSelfTestCheck & {
      tiers?: Partial<Record<NextoreTier, NextoreSelfTestCheck>>;
    };
  };
}
