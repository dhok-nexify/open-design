/**
 * Edition sign-in gate for the browser shell.
 *
 * The daemon refuses `/api/*` with `SESSION_REQUIRED` when the NexTore session
 * is missing, expired or revoked. Every caller in the app would otherwise show
 * its own error, so this wraps `window.fetch` once and turns that one code into
 * a navigation to `/auth/start`, which is the daemon's OAuth entry point.
 *
 * API responses trigger on SESSION_REQUIRED, never a bare 401. The session
 * heartbeat is the one deliberate exception: it asks the edition-only
 * `/auth/me` endpoint, where 401 means exactly "signed out". Upstream
 * deployments never install this wrapper.
 */

import { NEXTORE_WEB_EDITION } from './features';
import { isSignedOut } from './sign-out';

const SESSION_REQUIRED = 'SESSION_REQUIRED';
const REDIRECT_FLAG = 'nxd:session-redirect';
const REDIRECT_COOLDOWN_MS = 10_000;
const SESSION_HEARTBEAT_MS = 5 * 60 * 1000;

interface SessionErrorBody {
  error?: { code?: unknown };
}

function alreadyRedirecting(): boolean {
  try {
    const last = Number(window.sessionStorage.getItem(REDIRECT_FLAG) ?? '0');
    return Number.isFinite(last) && Date.now() - last < REDIRECT_COOLDOWN_MS;
  } catch {
    return false;
  }
}

function markRedirecting(): void {
  try {
    window.sessionStorage.setItem(REDIRECT_FLAG, String(Date.now()));
  } catch {
    // Private mode without storage still gets one redirect per page load.
  }
}

function goToSignIn(): void {
  // An explicit sign-out is a choice, not a failure. Bouncing straight back
  // into OAuth would re-create the session the person just ended, so this tab
  // stays on the signed-out page until they ask to sign in again.
  if (isSignedOut()) return;
  if (alreadyRedirecting()) return;
  markRedirecting();

  const here = window.location.pathname + window.location.search + window.location.hash;
  window.location.assign('/auth/start?return=' + encodeURIComponent(here || '/'));
}

export function installNextoreSessionRedirect(): void {
  if (typeof window === 'undefined' || NEXTORE_WEB_EDITION !== 'nextore') return;

  const target = window as unknown as { __nxdSessionRedirect?: boolean };
  if (target.__nxdSessionRedirect) return;
  target.__nxdSessionRedirect = true;

  const original = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const response = await original(input, init);

    if (response.status === 401) {
      // Clone before the caller consumes the body.
      void response
        .clone()
        .json()
        .then((body: SessionErrorBody) => {
          if (body?.error?.code === SESSION_REQUIRED) goToSignIn();
        })
        .catch(() => {
          // Not JSON: another 401 with its own meaning. Leave it alone.
        });
    }

    return response;
  };

  // The daemon revalidates a session every five minutes. Pinging it from the
  // shell keeps that check running while the user is idle (including while an
  // SSE stream is open) and turns a revoked session into the same redirect as
  // any other call. `/auth/me` answers 401 with `{ signedIn: false }`, so the
  // status is checked directly instead of the SESSION_REQUIRED body.
  window.setInterval(() => {
    void window
      .fetch('/auth/me', { cache: 'no-store', headers: { accept: 'application/json' } })
      .then((response) => {
        if (response.status === 401) goToSignIn();
      })
      .catch(() => {
        // A transient daemon/network failure must not sign the user out.
      });
  }, SESSION_HEARTBEAT_MS);
}
