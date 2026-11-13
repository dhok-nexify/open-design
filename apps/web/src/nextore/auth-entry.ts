/**
 * The single OAuth entry point builder for the NexTore edition.
 *
 * Two flows navigate here: signing in again after an explicit sign-out, and the
 * silent re-authentication that notices a sign-out or an account switch at the
 * site. Both must sanitise the return path the same way, because a
 * protocol-relative value (`//evil.test`) turns the login redirect into an
 * open redirect — so the rule lives once, not in two copies that can drift.
 */

/** `/auth/start` with a same-origin return path; anything else becomes `/`. */
export function authStartUrl(returnTo: string = '/'): string {
  const path = returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/';
  return '/auth/start?return=' + encodeURIComponent(path || '/');
}
