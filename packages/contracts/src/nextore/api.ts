import type { Edition } from './edition.js';

export const NEXTORE_MODULE_COMPATIBILITY = '>=1.0 <2';

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
