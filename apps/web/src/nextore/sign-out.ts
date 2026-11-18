/**
 * Explicit sign-out for the NexTore edition.
 *
 * The main site cannot do this for us. Logging out of NexTore ends the
 * browser's main-system session, while the Designer authenticates with an
 * OAuth connection that renews itself until an administrator revokes it — so a
 * Designer tab keeps working after the site has been signed out, or signed in
 * as somebody else. Until the platform carries back-channel logout, the person
 * at the keyboard needs a control that ends *this* session, and a page that
 * stays ended instead of bouncing straight back into OAuth.
 */
import { authStartUrl } from './auth-entry';
import { NEXTORE_WEB_EDITION } from './features';

const SIGNED_OUT_KEY = 'nxd:signed-out';

/** Cross-tab logout channel. Origin-scoped by the platform. */
export const AUTH_SYNC_CHANNEL_NAME = 'auth_sync_channel';

export interface AuthSyncSignedOutMessage {
  type: 'signed-out';
  at: number;
}

let authChannel: BroadcastChannel | null = null;
let authSyncCleanup: (() => void) | null = null;

function authSyncChannel(): BroadcastChannel | null {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return null;
  if (authChannel) return authChannel;
  try {
    authChannel = new BroadcastChannel(AUTH_SYNC_CHANNEL_NAME);
    return authChannel;
  } catch {
    return null;
  }
}

/**
 * Cached read of the marker.
 *
 * `App.tsx` asks this on every render, and the marker only ever changes
 * through the functions below, so the storage read happens once per document.
 * A sign-out ends with a navigation, which starts a fresh document anyway.
 */
let signedOut: boolean | null = null;

export function isSignedOut(): boolean {
  if (NEXTORE_WEB_EDITION !== 'nextore') return false;
  if (signedOut === null) {
    try {
      signedOut = window.sessionStorage.getItem(SIGNED_OUT_KEY) === '1';
    } catch {
      // Storage disabled: the marker is a convenience, the daemon row is truth.
      signedOut = false;
    }
  }
  return signedOut;
}

function setSignedOut(value: boolean): void {
  signedOut = value;
  try {
    if (value) window.sessionStorage.setItem(SIGNED_OUT_KEY, '1');
    else window.sessionStorage.removeItem(SIGNED_OUT_KEY);
  } catch {
    // Ignored: the cached value still describes this document.
  }
}

export function clearSignedOut(): void {
  setSignedOut(false);
}

/** Marks this tab signed out without navigating. Used by the cross-tab listener. */
export function markSignedOut(): void {
  setSignedOut(true);
}

/** Tells every other same-origin tab that the shared daemon session ended. */
export function broadcastSignedOut(nowMs: number = Date.now()): void {
  const channel = authSyncChannel();
  if (!channel) return;
  const message: AuthSyncSignedOutMessage = { type: 'signed-out', at: nowMs };
  try {
    channel.postMessage(message);
  } catch {
    // A closed channel or a structured-clone failure must not break sign-out.
  }
}

/**
 * Installs the cross-tab listener once per document. The sending tab updates its
 * own marker first, so this listener deliberately ignores its own message
 * (BroadcastChannel does not deliver to the sender anyway).
 */
export function installAuthSync(
  onSignedOut: (url: string) => void = (url) => window.location.assign(url),
): () => void {
  if (authSyncCleanup) return authSyncCleanup;
  const channel = authSyncChannel();
  if (!channel) {
    authSyncCleanup = () => {};
    return authSyncCleanup;
  }
  const onMessage = (event: MessageEvent<AuthSyncSignedOutMessage>) => {
    if (event.data?.type !== 'signed-out') return;
    setSignedOut(true);
    onSignedOut('/');
  };
  channel.addEventListener('message', onMessage);
  authSyncCleanup = () => {
    channel.removeEventListener('message', onMessage);
  };
  return authSyncCleanup;
}

/** Test helper: removes the listener and releases the channel. */
export function resetAuthSyncForTests(): void {
  authSyncCleanup?.();
  authSyncCleanup = null;
  try {
    authChannel?.close();
  } catch {
    // Ignore: the channel may already be closed.
  }
  authChannel = null;
}

/** The OAuth entry point. See `auth-entry.ts` for why the path is filtered. */
export function signInUrl(returnTo = '/'): string {
  return authStartUrl(returnTo);
}

/**
 * Deletes this session's row on the daemon. Only a 2xx counts as ended: the
 * caller must not claim the session is over when it is still live server-side.
 */
export async function signOutOfDesigner(
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const response = await fetchImpl('/auth/logout', { method: 'POST' });
    if (!response.ok) return false;
    setSignedOut(true);
    broadcastSignedOut();
    return true;
  } catch {
    return false;
  }
}

/** Leaves the signed-out page and runs the OAuth sign-in again. */
export function signInAgain(
  navigate: (url: string) => void = (url) => window.location.assign(url),
): void {
  clearSignedOut();
  navigate(signInUrl('/'));
}
