import { resolveEdition } from '../edition/index.js';

/**
 * Whether third-party favicon services may be queried (DESIGN §13.3).
 *
 * The NexTore edition has to render without any external request, so brand references and logo
 * fallbacks stay on local assets and monogram placeholders instead of Google or DuckDuckGo.
 * A missing OD_EDITION keeps upstream behavior.
 */
export function publicFaviconServicesAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveEdition(env.OD_EDITION) !== 'nextore';
}
