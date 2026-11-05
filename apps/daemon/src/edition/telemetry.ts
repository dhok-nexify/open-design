import { resolveEdition } from './index.js';

/**
 * Whether outbound product telemetry may run (DESIGN §13.2, NXD-D27).
 *
 * The NexTore edition sends nothing to PostHog, Langfuse, or the telemetry relay even when a
 * deployment leaves a key in the environment. A missing OD_EDITION keeps upstream behavior.
 */
export function telemetryAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveEdition(env.OD_EDITION) !== 'nextore';
}
