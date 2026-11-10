/**
 * NexTore edition: a signed-in member can still lack the Designer access right.
 *
 * The daemon answers every API call with 403 DESIGNER_ACCESS_REQUIRED in that
 * case. Letting each feature surface its own error (and the first-run router
 * fall back to the upstream onboarding page) is both noisy and off-spec, so the
 * shell observes the code once and renders a dedicated refusal page instead.
 *
 * The guard wraps window.fetch after the session redirect wrapper, so a 401
 * still redirects to OAuth while a 403 is classified here.
 */

import { NEXTORE_WEB_EDITION } from './features';

export const DESIGNER_ACCESS_REQUIRED_EVENT = 'nxd:designer-access-required';

const DESIGNER_ACCESS_REQUIRED = 'DESIGNER_ACCESS_REQUIRED';

let designerAccessRequired = false;

export function isDesignerAccessRequired(): boolean {
  return designerAccessRequired;
}

function markDesignerAccessRequired(): void {
  if (designerAccessRequired) return;
  designerAccessRequired = true;
  try {
    window.dispatchEvent(new CustomEvent(DESIGNER_ACCESS_REQUIRED_EVENT));
  } catch {
    // Non-browser callers keep the module flag.
  }
}

/** Pure classifier shared by the fetch guard and its tests. */
export function isDesignerAccessRequiredBody(body: unknown): boolean {
  const code = (body as { error?: { code?: unknown } } | null)?.error?.code;
  return code === DESIGNER_ACCESS_REQUIRED;
}

export function installNextoreAccessRequiredGuard(): void {
  if (typeof window === 'undefined' || NEXTORE_WEB_EDITION !== 'nextore') return;

  const target = window as unknown as { __nxdAccessRequiredGuard?: boolean };
  if (target.__nxdAccessRequiredGuard) return;
  target.__nxdAccessRequiredGuard = true;

  const original = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const response = await original(input, init);
    if (response.status === 403) {
      void response
        .clone()
        .json()
        .then((body: unknown) => {
          if (isDesignerAccessRequiredBody(body)) markDesignerAccessRequired();
        })
        .catch(() => {
          // Not JSON: another 403 with its own meaning. Leave it alone.
        });
    }
    return response;
  };
}
