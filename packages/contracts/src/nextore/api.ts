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

export interface NextoreSelfTestCheck {
  status: 'ok' | 'unavailable';
  message?: string;
  statusCode?: number;
}

export interface NextoreSelfTestResponse {
  ok: boolean;
  edition: 'nextore';
  checks: {
    module: NextoreSelfTestCheck;
    branding: NextoreSelfTestCheck;
    authentication: {
      status: 'pending_session';
      message: string;
    };
    llm: {
      status: 'pending_session';
      message: string;
    };
  };
}
