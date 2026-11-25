/**
 * Edition sign-in gate for the browser shell.
 *
 * This supersedes the original `session.ts` implementation, which is kept in
 * place while the checkout is locked by another process. The contract is the
 * same: a `SESSION_REQUIRED` response navigates to `/auth/start`, and the
 * five-minute heartbeat owns silent re-authentication. Revocation itself is
 * pushed: every tab keeps one `/auth/session/events` stream open, the daemon
 * validates that session on its own timer, and a revoked connection closes the
 * stream with `state: revoked`. The browser does not poll. A return to the tab
 * still runs one `/auth/me?revalidate=1` as a cheap safety net for a stream
 * that dropped, and the cross-tab sign-out marker covers explicit sign-outs.
 * None of it starts an OAuth round trip by itself.
 */

import { NEXTORE_WEB_EDITION } from './features';
import {
  lastSilentReauthAttempt,
  markSilentReauthAttempt,
  shouldSilentlyRevalidate,
  silentReauthAllowed,
  silentReauthUrl,
} from './silent-reauth';
import { broadcastSignedOut, isSignedOut, markSignedOut } from './sign-out';

const SESSION_REQUIRED = 'SESSION_REQUIRED';
const REDIRECT_FLAG = 'nxd:session-redirect';
const REDIRECT_COOLDOWN_MS = 10_000;
const SESSION_HEARTBEAT_MS = 5 * 60 * 1000;
/**
 * The daemon's push channel for this session.
 *
 * The daemon validates a subscribed session on one timer of its own and writes
 * `session` with `state: revoked` to every open tab, so the browser never
 * schedules a re-check. One stream per tab, not one request per tab per
 * interval: five tabs cost five idle connections and zero polls.
 */
const SESSION_STREAM_PATH = '/auth/session/events';
/**
 * Only for a browser without EventSource: a slow visible-tab probe. Kept far
 * above the old ten seconds on purpose — a missing push channel is a reason to
 * degrade, not to reintroduce the polling load.
 */
const STREAM_FALLBACK_POLL_MS = 60_000;
/** How often a broken stream may trigger one plain probe, at most. */
const STREAM_ERROR_PROBE_COOLDOWN_MS = 10_000;
const VISIBILITY_CHECK_COOLDOWN_MS = 5_000;
/**
 * The public share route is read by people who have no Designer account at all.
 * Every session probe there answers 401, which is not a signed-out tab: an
 * anonymous reader is the expected state, so the guard must never treat it as a
 * reason to start OAuth.
 */
const PUBLIC_SHARE_PATH = '/share';

function isPublicShareRoute(): boolean {
  if (typeof window === 'undefined') return false;
  const path = window.location.pathname.replace(/\/+$/u, '');
  return path === PUBLIC_SHARE_PATH;
}

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
let fallbackTimer: number | null = null;
let sessionStream: EventSource | null = null;
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

  /**
   * The daemon ended this session because the site revoked it (sign-out, lock,
   * or delete). Do NOT start OAuth here: the site may still be finishing its
   * own sign-out, and an authorize request in that window answers with a
   * platform error instead of the login page. The session row is already gone
   * server-side; show the signed-out page and let the person choose to sign in
   * again.
   */
  function endRevokedSession(): void {
    markSignedOut();
    broadcastSignedOut();
    navigate('/');
  }

  function goToSignIn(): void {
    // A reader on a shared link has no session to lose.
    if (isPublicShareRoute()) return;
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

  // The reader route keeps the 401 wrapper above but starts no session stream,
  // heartbeat, or visibility probe: there is no session to renew there, and one
  // stray navigation would replace the document with the NexTore sign-in page.
  if (isPublicShareRoute()) return;

  heartbeatTimer = window.setInterval(() => checkSession(true), SESSION_HEARTBEAT_MS);

  // null, not 0: the injected clock in tests may start at a small value, and
  // "0" would then read as a probe that just happened.
  let lastStreamErrorProbe: number | null = null;
  function openSessionStream(): void {
    // The signed-out page has no session to revoke, and its stream would retry
    // a 401 forever.
    if (isSignedOut()) return;
    if (typeof EventSource === 'undefined') {
      fallbackTimer = window.setInterval(() => {
        if (document.visibilityState !== 'visible') return;
        if (isSignedOut()) return;
        checkSession(false, true);
      }, STREAM_FALLBACK_POLL_MS);
      return;
    }

    const source = new EventSource(SESSION_STREAM_PATH, { withCredentials: true });
    sessionStream = source;
    source.addEventListener('session', (event) => {
      let state: unknown = null;
      try {
        state = (JSON.parse((event as MessageEvent).data as string) as { state?: unknown }).state;
      } catch {
        return;
      }
      if (state !== 'revoked') return;
      source.close();
      if (sessionStream === source) sessionStream = null;
      // The daemon already ended the row. Land on the signed-out page rather
      // than bouncing into OAuth (see endRevokedSession).
      endRevokedSession();
    });
    source.addEventListener('error', () => {
      // EventSource retries by itself, so a server restart heals without help.
      // A revoked session answers 401, which the browser would retry forever,
      // so one plain probe decides whether to keep waiting or sign out.
      if (isSignedOut()) {
        source.close();
        if (sessionStream === source) sessionStream = null;
        return;
      }
      if (source.readyState === EventSource.CLOSED) return;
      const at = now();
      if (
        lastStreamErrorProbe !== null
        && at - lastStreamErrorProbe < STREAM_ERROR_PROBE_COOLDOWN_MS
      ) return;
      lastStreamErrorProbe = at;
      checkSession(false, false);
    });
  }
  openSessionStream();

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
    if (fallbackTimer !== null) {
      window.clearInterval(fallbackTimer);
      fallbackTimer = null;
    }
    sessionStream?.close();
    sessionStream = null;
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
  if (fallbackTimer !== null) {
    window.clearInterval(fallbackTimer);
    fallbackTimer = null;
  }
  sessionStream?.close();
  sessionStream = null;
  if (visibilityHandler) {
    document.removeEventListener('visibilitychange', visibilityHandler);
    window.removeEventListener('focus', visibilityHandler);
    visibilityHandler = null;
  }
  const target = window as unknown as { __nxdSessionRedirect?: boolean };
  delete target.__nxdSessionRedirect;
}
