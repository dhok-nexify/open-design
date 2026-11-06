import type { Edition } from '@open-design/contracts';

/**
 * The deployment's public origin must be an allowed browser origin (NXD-D24).
 *
 * Behind a reverse proxy the daemon sees its own internal port, so a same-origin
 * POST from the page (`Origin: https://designer.example`) looks cross-origin and
 * every mutation is rejected with 403. The edition already requires
 * `DESIGNER_BASE_URL` and validates it as a bare origin, so trusting exactly that
 * value is narrower than asking an operator to duplicate it in
 * `OD_ALLOWED_ORIGINS`.
 */
export function addDesignerOrigin(
  origins: readonly string[],
  edition: Edition,
  designerBaseUrl: string | null | undefined,
): string[] {
  if (edition !== 'nextore') return [...origins];
  const origin = designerBaseUrl?.trim().replace(/\/+$/, '');
  if (!origin) return [...origins];
  if (origins.includes(origin)) return [...origins];
  return [...origins, origin];
}
