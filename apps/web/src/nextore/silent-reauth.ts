/**
 * Silent re-authentication for the NexTore edition (NXD-D41).
 *
 * The site cannot tell this daemon that the member signed out, and the browser
 * will not hand the site's session cookie to a cross-site subresource, so no
 * fetch can detect it. A **top-level navigation** to /auth/start does carry
 * that cookie: with a live site session and a trusted client the site answers
 * with a code and no consent page, and the callback replaces this session; with
 * a signed-out or switched account the person lands on the site's own sign-in,
 * and the session that follows belongs to whoever is really at the keyboard.
 *
 * That round trip is the only detection available without a platform change,
 * so the shell runs it on the daemon's schedule — but never in a background
 * tab, and never again within the retry cooldown, because a refusal (a site
 * that shows consent, or a cancelled approval) must not bounce every five
 * minutes.
 */
import { authStartUrl } from './auth-entry';
import { NEXTORE_WEB_EDITION } from './features';

const ATTEMPT_KEY = 'nxd:silent-reauth-at';

/** One attempt per half hour per tab, whatever the daemon keeps reporting. */
export const SILENT_REAUTH_COOLDOWN_MS = 30 * 60 * 1000;

/** The OAuth entry point for the path the person is currently on. */
export function silentReauthUrl(currentPath: string): string {
  return authStartUrl(currentPath);
}

/**
 * A background tab must not bounce: the redirect would replace what the person
 * left there, and it would fire while nobody can see what happened.
 */
export function shouldSilentlyRevalidate(reauthDue: boolean, visibilityState: string): boolean {
  return reauthDue === true && visibilityState === 'visible';
}

export function silentReauthAllowed(lastAttemptAt: number | null, nowMs: number): boolean {
  if (lastAttemptAt === null) return true;
  if (!Number.isFinite(lastAttemptAt)) return true;
  return nowMs - lastAttemptAt >= SILENT_REAUTH_COOLDOWN_MS;
}

function readAttempt(): number | null {
  if (NEXTORE_WEB_EDITION !== 'nextore') return null;
  try {
    const raw = window.sessionStorage.getItem(ATTEMPT_KEY);
    if (raw === null) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

/** Records the attempt before navigating, so a refusal cannot loop. */
export function markSilentReauthAttempt(nowMs: number = Date.now()): void {
  try {
    window.sessionStorage.setItem(ATTEMPT_KEY, String(nowMs));
  } catch {
    // Storage disabled: the daemon's own session age still bounds the retries.
  }
}

export function lastSilentReauthAttempt(): number | null {
  return readAttempt();
}

/** Test helper: forget this tab's attempt history. */
export function resetSilentReauthAttempt(): void {
  try {
    window.sessionStorage.removeItem(ATTEMPT_KEY);
  } catch {
    // Ignored.
  }
}
