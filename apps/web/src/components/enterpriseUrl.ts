// Shared helper for the marketing "Workspace for Teams" link. The Nexify site
// is the public marketing surface for this distribution, so every locale opens
// the same site root; the previous per-locale enterprise deep links only
// existed on the upstream site.
const NEXIFY_SITE = 'http://www.nexify.com.hk/';

export function enterpriseUrl(_locale: string): string {
  return NEXIFY_SITE;
}
