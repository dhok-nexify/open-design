import type { RequestHandler } from 'express';
import type { Edition, NextoreFeature } from '@open-design/contracts';

interface DisabledRouteRule {
  feature: NextoreFeature;
  pattern: RegExp;
}

function routePattern(path: string): RegExp {
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped}(?:/|$)`);
}

function rules(feature: NextoreFeature, paths: readonly string[]): DisabledRouteRule[] {
  return paths.map((path) => ({ feature, pattern: routePattern(path) }));
}

const NEXTORE_DISABLED_ROUTE_RULES: readonly DisabledRouteRule[] = Object.freeze([
  ...rules('onboarding', ['/onboarding']),
  ...rules('cloud-amr', ['/api/amr', '/api/integrations/vela']),
  ...rules('campaigns', ['/api/campaigns']),
  ...rules('telemetry', ['/api/analytics', '/api/observability', '/api/telemetry']),
  ...rules('whats-new', ['/api/whats-new']),
  ...rules('updater', ['/api/updater']),
  ...rules('privacy-consent', ['/api/consent', '/api/privacy']),
  ...rules('survey', ['/api/survey']),
  ...rules('github-metadata', ['/api/github']),
  ...rules('discord', ['/api/discord']),
  ...rules('attribution', ['/api/attribution']),
  ...rules('social-share', ['/api/social-share']),
  ...rules('community', ['/api/community']),
  ...rules('marketplace-remote', ['/api/marketplaces', '/api/plugins/install']),
  ...rules('connectors', ['/api/connectors']),
  ...rules('deploy', ['/api/deploy', '/api/deployments']),
  { feature: 'deploy', pattern: /^\/api\/projects\/[^/]+\/deploy(?:\/|$)/ },
  ...rules('handoff-cli', ['/api/handoff']),
  ...rules('research-tavily', ['/api/research']),
  ...rules('xai', ['/api/xai']),
  ...rules('pets', ['/api/codex-pets']),
  ...rules('collab-cloud', ['/api/collab']),
  ...rules('byok-settings', [
    '/api/connection-test',
    '/api/provider',
    '/api/providers',
    '/api/proxy',
  ]),
  // The list endpoint is the UI's availability probe (NXD-D15); only the
  // management subroutes stay closed.
  { feature: 'agent-picker', pattern: /^\/api\/agents\/.+$/ },
  ...rules('media-providers', ['/api/media/models', '/api/media/providers', '/api/media/config']),
  { feature: 'terminals', pattern: /^\/api\/projects\/[^/]+\/terminals(?:\/|$)/ },
  ...rules('terminals', ['/api/terminals']),
  ...rules('host-tools', ['/api/host-tools']),
  ...rules('native-dialog', ['/api/dialog', '/api/import/folder']),
  ...rules('library-clipper', ['/api/library']),
  ...rules('orbit', ['/api/orbit']),
  ...rules('od-mcp-server', ['/api/mcp/live-artifacts', '/api/mcp/server']),
  ...rules('design-browser', ['/api/browser', '/api/design-browser']),
  ...rules('figma', ['/api/figma']),
  ...rules('automations', ['/api/automations', '/api/routines']),
  ...rules('hyperframes', ['/api/hyperframes']),
  ...rules('od-next', ['/api/od-next']),
  { feature: 'media-generation', pattern: /^\/api\/projects\/[^/]+\/media\/generate(?:\/|$)/ },
] satisfies DisabledRouteRule[]);

export function disabledFeatureForPath(path: string): NextoreFeature | null {
  for (const rule of NEXTORE_DISABLED_ROUTE_RULES) {
    if (rule.pattern.test(path)) return rule.feature;
  }
  return null;
}

/**
 * Mount before body parsers and business routes. The middleware is a no-op in
 * upstream, and in the NexTore edition it makes disabled server capabilities
 * indistinguishable from routes that do not exist.
 */
export function createEditionRouteKillSwitch(edition: Edition): RequestHandler {
  return (req, res, next) => {
    if (edition !== 'nextore') return next();

    const feature = disabledFeatureForPath(req.path);
    if (!feature) return next();
    res.status(404).json({ error: 'feature_disabled', feature });
  };
}
