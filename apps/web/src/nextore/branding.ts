import type { NextoreBrandingResponse } from '@open-design/contracts';

import { NEXTORE_WEB_EDITION } from './features';
import { setBrandName } from '../i18n';
import { applyAccentToDocument } from '../state/appearance';

let cached: NextoreBrandingResponse | null = null;

function faviconHref(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed, window.location.origin).toString();
  } catch {
    return null;
  }
}

/**
 * Applies the module's brand payload to the document (DESIGN §12.1): title, favicon, theme color
 * and `--nexTore-brand-primary`. The edition has no accent picker, so the brand colour also
 * seeds the default accent; a user-saved non-default accent is preserved.
 */
export function applyBranding(branding: NextoreBrandingResponse): void {
  if (branding.brandName?.trim()) setBrandName(branding.brandName);
  if (typeof document === 'undefined') return;

  if (branding.siteTitle?.trim()) {
    document.title = branding.siteTitle.trim();
  }

  const primaryColor = branding.primaryColor?.trim();
  if (primaryColor) {
    document.documentElement.style.setProperty('--nexTore-brand-primary', primaryColor);
    // The edition has no accent picker. Apply the module's brand colour as the
    // default accent, while preserving a non-default accent a user saved before.
    const currentAccent = document.documentElement.style.getPropertyValue('--accent').trim();
    if (!currentAccent || currentAccent === '#353535') applyAccentToDocument(primaryColor);
    let meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'theme-color');
      document.head.appendChild(meta);
    }
    meta.setAttribute('content', primaryColor);
  }

  const href = branding.favicon ? faviconHref(branding.favicon) : null;
  if (href) {
    let link = document.querySelector('link[rel="icon"]') as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.href = href;
  }
}

/** Fetches the cached daemon branding payload once per page load. */
export async function fetchBranding(): Promise<NextoreBrandingResponse | null> {
  if (cached) return cached;

  try {
    const response = await fetch('/api/branding', { headers: { accept: 'application/json' } });
    if (!response.ok) return null;
    cached = (await response.json()) as NextoreBrandingResponse;
    return cached;
  } catch {
    return null;
  }
}

/** Boot-time entry point: only the NexTore edition has a branding source. */
export async function bootstrapBranding(): Promise<NextoreBrandingResponse | null> {
  if (NEXTORE_WEB_EDITION !== 'nextore') return null;
  const branding = await fetchBranding();
  if (branding) applyBranding(branding);
  return branding;
}

/** Test seam. */
export function resetBrandingCache(): void {
  cached = null;
}
