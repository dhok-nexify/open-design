/**
 * Edition sign-in gate for the browser shell.
 *
 * This supersedes the original `session.ts` implementation, which is kept in
 * place while the checkout is locked by another process. The contract is the
 * same: a `SESSION_REQUIRED` response navigates to `/auth/start`, and the
 * five-minute heartbeat owns silent re-authentication. The additions here are a
 * foreground revalidation — when a tab becomes visible or focused again, one
 * `/auth/me?revalidate=1` check asks the module whether the OAuth connection
 * still exists, instead of trusting a validation up to five minutes old — and
 * the cross-tab sign-out marker. It never starts an OAuth round trip by itself.
 */

import { NEXTORE_WEB_EDITION } from './features';
import {
  lastSilentReauthAttempt,
  markSilentReauthAttempt,
  shouldSilentlyRevalidate,
  silentReauthAllowed,
  silentReauthUrl,
} from './silent-reauth';
import { isSignedOut } from './sign-out';

const SESSION_REQUIRED = 'SESSION_REQUIRED';
const REDIRECT_FLAG = 'nxd:session-redirect';
const REDIRECT_COOLDOWN_MS = 10_000;
const SESSION_HEARTBEAT_MS = 5 * 60 * 1000;
/**
 * How often a VISIBLE tab re-asks the module whether its connection is alive.
 *
 * The five-minute heartbeat above only handles silent re-authentication. A
 * sign-out at the site must not wait for it: while somebody is looking at this
 * tab, a connection the site cut has to end the session within seconds. Twenty
 * seconds is the largest delay a person does not read as "still signed in",
 * and it is above the daemon's own 15-second floor, so N open tabs still
 * produce at most one module call per interval.
 */
const FOREGROUND_PROBE_MS = 20_000;
const VISIBILITY_CHECK_COOLDOWN_MS = 5_000;

interface SessionErrorBody {
  error?: { code?: unknown };
}

export interface NextoreSessionRedirectOptions {
  /** Injectable for tests; defaults to the page's own fetch. */
  fetchImpl?: typeof fetch;
  /** Injectable for tests so a 401 can be asserted without a real navigation. */
  navigate?: (url: string) => void;
  /** Injectable clock; defaults to Date.now. */
  now?: () => number;
}

let heartbeatTimer: number | null = null;
let foregroundTimer: number | null = null;
let visibilityHandler: (() => void) | null = null;

const GUARD_WINDOW_KEY = '__nxdSessionGuardCleanup';

/**
 * Removes a listener installed by an earlier module instance (HMR, or a test
 * that reset the module registry). Without this, a stale visibility handler
 * can consume the new instance's mock and set the redirect cooldown.
 */
function cleanupPreviousGuard(): void {
  if (typeof window === 'undefined') return;
  const holder = window as unknown as Record<string, unknown>;
  const cleanup = holder[GUARD_WINDOW_KEY];
  delete holder[GUARD_WINDOW_KEY];
  if (typeof cleanup === 'function') {
    try {
      (cleanup as () => void)();
    } catch {
      // A stale cleanup must not block the new install.
    }
  }
}

export function installNextoreSessionRedirect(
  options: NextoreSessionRedirectOptions = {},
): void {
  if (typeof window === 'undefined' || NEXTORE_WEB_EDITION !== 'nextore') return;

  cleanupPreviousGuard();
  const target = window as unknown as { __nxdSessionRedirect?: boolean };
  if (target.__nxdSessionRedirect) return;
  target.__nxdSessionRedirect = true;

  const fetchImpl = options.fetchImpl ?? window.fetch.bind(window);
  const navigate = options.navigate ?? ((url: string) => window.location.assign(url));
  const now = options.now ?? Date.now;
  let checking = false;
  let lastVisibilityCheck = 0;

  function alreadyRedirecting(): boolean {
    try {
      const last = Number(window.sessionStorage.getItem(REDIRECT_FLAG) ?? '0');
      return Number.isFinite(last) && last > 0 && now() - last < REDIRECT_COOLDOWN_MS;
    } catch {
      return false;
    }
  }

  function markRedirecting(): void {
    try {
      window.sessionStorage.setItem(REDIRECT_FLAG, String(now()));
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
    navigate('/auth/start?return=' + encodeURIComponent(here || '/'));
  }

  function checkSession(allowSilentReauth: boolean, forceRevalidate = false): void {
    if (checking) return;
    checking = true;
    // `revalidate=1` is the foreground probe: the daemon re-asks the module
    // whether this OAuth connection is still alive. Without it a connection
    // the site cut at sign-out stays "signed in" until the five-minute budget
    // expires, which is exactly what the walkthrough reported.
    void fetchImpl(forceRevalidate ? '/auth/me?revalidate=1' : '/auth/me', {
      cache: 'no-store',
      headers: { accept: 'application/json' },
    })
      .then(async (response) => {
        if (response.status === 401) {
          goToSignIn();
          return;
        }
        if (!response.ok) return;

        // The heartbeat still owns renewal. The visibility path only answers
        // whether this session is valid; it does not renew it.
        if (!allowSilentReauth) return;
        const body = (await response.json().catch(() => null)) as { reauthDue?: unknown } | null;
        if (!shouldSilentlyRevalidate(body?.reauthDue === true, document.visibilityState)) return;
        if (!silentReauthAllowed(lastSilentReauthAttempt(), now())) return;

        markSilentReauthAttempt(now());
        const here = window.location.pathname + window.location.search + window.location.hash;
        navigate(silentReauthUrl(here || '/'));
      })
      .catch(() => {
        // A transient daemon/network failure must not sign the user out.
      })
      .finally(() => {
        checking = false;
      });
  }

  const originalFetch = fetchImpl;
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const response = await originalFetch(input, init);

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

  heartbeatTimer = window.setInterval(() => checkSession(true), SESSION_HEARTBEAT_MS);
  // The visible-tab watchdog. A hidden tab probes nothing — nobody can act on
  // what it would show, and the focus/visibility handlers cover the moment it
  // comes back.
  foregroundTimer = window.setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    if (isSignedOut()) return;
    checkSession(false, true);
  }, FOREGROUND_PROBE_MS);

  visibilityHandler = () => {
    if (document.visibilityState !== 'visible') return;
    if (isSignedOut()) return;
    const at = now();
    if (lastVisibilityCheck > 0 && at - lastVisibilityCheck < VISIBILITY_CHECK_COOLDOWN_MS) return;
    lastVisibilityCheck = at;
    checkSession(false, true);
  };
  document.addEventListener('visibilitychange', visibilityHandler);
  // A window focus without a visibility change (the browser kept the tab
  // "visible" while another window had focus) is the same moment from the
  // person's point of view, so it runs the same cooldown-gated probe.
  window.addEventListener('focus', visibilityHandler);

  const cleanup = () => {
    if (heartbeatTimer !== null) {
      window.clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    if (foregroundTimer !== null) {
      window.clearInterval(foregroundTimer);
      foregroundTimer = null;
    }
    if (visibilityHandler) {
      document.removeEventListener('visibilitychange', visibilityHandler);
      window.removeEventListener('focus', visibilityHandler);
      visibilityHandler = null;
    }
    delete target.__nxdSessionRedirect;
  };
  (window as unknown as Record<string, unknown>)[GUARD_WINDOW_KEY] = cleanup;
}

/** Test helper: removes this document's heartbeat and visibility listener. */
export function resetNextoreSessionRedirectForTests(): void {
  if (typeof window === 'undefined') return;
  cleanupPreviousGuard();
  if (heartbeatTimer !== null) {
    window.clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  if (foregroundTimer !== null) {
    window.clearInterval(foregroundTimer);
    foregroundTimer = null;
  }
  if (visibilityHandler) {
    document.removeEventListener('visibilitychange', visibilityHandler);
    window.removeEventListener('focus', visibilityHandler);
    visibilityHandler = null;
  }
  const target = window as unknown as { __nxdSessionRedirect?: boolean };
  delete target.__nxdSessionRedirect;
}
