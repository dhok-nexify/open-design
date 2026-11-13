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
import { NEXTORE_WEB_EDITION } from './features';

const SIGNED_OUT_KEY = 'nxd:signed-out';

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

/** The OAuth entry point. `return` must stay a same-origin path. */
export function signInUrl(returnTo = '/'): string {
  const path = returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/';
  return '/auth/start?return=' + encodeURIComponent(path);
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
