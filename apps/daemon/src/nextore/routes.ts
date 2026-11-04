import type { Express, RequestHandler, Response } from 'express';
import type { NextoreSelfTestCheck, NextoreSelfTestResponse } from '@open-design/contracts';
import { NextoreClientError, type NextoreClient } from './client.js';

export interface RegisterNextoreRoutesDeps {
  client: NextoreClient;
}

function failedCheck(error: unknown): NextoreSelfTestCheck {
  if (error instanceof NextoreClientError) {
    return {
      status: 'unavailable',
      message: error.code,
      ...(error.statusCode === undefined ? {} : { statusCode: error.statusCode }),
    };
  }
  return { status: 'unavailable', message: 'nextore_request_failed' };
}

export function nextoreHealthMetadata(edition: 'upstream' | 'nextore', version: unknown) {
  if (edition !== 'nextore') return {};
  return {
    edition,
    compat: {
      module: '>=1.0 <2',
    },
    version,
  };
}

export function createNextoreSelfTestHandler(
  client: NextoreClient,
): RequestHandler {
  return async (_req, res: Response) => {
    const [moduleResult, brandingResult] = await Promise.allSettled([
      client.health(),
      client.branding(),
    ]);

    const moduleCheck: NextoreSelfTestCheck = moduleResult.status === 'fulfilled'
      ? { status: 'ok' }
      : failedCheck(moduleResult.reason);
    const brandingCheck: NextoreSelfTestCheck = brandingResult.status === 'fulfilled'
      ? { status: 'ok' }
      : failedCheck(brandingResult.reason);

    const response: NextoreSelfTestResponse = {
      ok: moduleCheck.status === 'ok' && brandingCheck.status === 'ok',
      edition: 'nextore',
      checks: {
        module: moduleCheck,
        branding: brandingCheck,
        authentication: {
          status: 'pending_session',
          message: 'Authentication checks are available after the OAuth session is established.',
        },
        llm: {
          status: 'pending_session',
          message: 'Model checks require an authenticated NexTore session.',
        },
      },
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
}
