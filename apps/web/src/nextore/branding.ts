import { useSyncExternalStore } from 'react';

import type { NextoreBrandingResponse } from '@open-design/contracts';

import { NEXTORE_WEB_EDITION } from './features';
import { setBrandName } from '../i18n';
import { applyAccentToDocument } from '../state/appearance';

let cached: NextoreBrandingResponse | null = null;
let lastRefreshAt = 0;
const listeners = new Set<() => void>();

/** A focus event must not cost a NexTore round trip more than once a minute. */
const REFRESH_THROTTLE_MS = 60_000;

function publish(next: NextoreBrandingResponse | null): void {
  cached = next;
  for (const listener of listeners) listener();
}

/**
 * Branding is an external store rather than component state: it is fetched at
 * boot and revalidated outside any component tree, while the splash and the
 * refusal page only need to read the latest payload.
 */
export function subscribeBranding(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getBrandingSnapshot(): NextoreBrandingResponse | null {
  return cached;
}

export function useBranding(): NextoreBrandingResponse | null {
  return useSyncExternalStore(subscribeBranding, getBrandingSnapshot, () => null);
}

/** Resolves a configured asset (absolute URL, path or data URI) to a usable href. */
export function resolveBrandingAsset(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (typeof window === 'undefined') return trimmed;
  try {
    return new URL(trimmed, window.location.origin).toString();
  } catch {
    return null;
  }
}

/**
 * The logo for one surface. `light` means "drawn for a light background",
 * `dark` means "drawn for a dark background". Each surface falls back to the
 * other variant before giving up, so uploading a single logo still works.
 */
export function brandingLogoUrl(
  branding: NextoreBrandingResponse | null,
  surface: 'light' | 'dark',
): string | null {
  if (!branding) return null;
  const preferred = surface === 'dark' ? branding.logoDark : branding.logoLight;
  const fallback = surface === 'dark' ? branding.logoLight : branding.logoDark;
  return resolveBrandingAsset(preferred) ?? resolveBrandingAsset(fallback);
}

function faviconHref(value: string): string | null {
  return resolveBrandingAsset(value);
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
    publish((await response.json()) as NextoreBrandingResponse);
    return cached;
  } catch {
    return null;
  }
}

/**
 * Revalidates the branding payload and applies it, so a brand saved in the
 * module settings page reaches an open Designer tab without a restart. The
 * daemon answers 304 while the version is unchanged, so the usual cost is a
 * header-only round trip at most once a minute (window focus is the trigger).
 */
export async function refreshBranding(): Promise<NextoreBrandingResponse | null> {
  if (NEXTORE_WEB_EDITION !== 'nextore') return null;
  const now = Date.now();
  // Returning null when nothing new was fetched keeps the caller from
  // re-rendering the shell on every focus event.
  if (lastRefreshAt !== 0 && now - lastRefreshAt < REFRESH_THROTTLE_MS) return null;
  lastRefreshAt = now;
  try {
    const response = await fetch('/api/branding', {
      cache: 'no-cache',
      headers: { accept: 'application/json' },
    });
    if (!response.ok) return null;
    const value = (await response.json()) as NextoreBrandingResponse;
    publish(value);
    applyBranding(value);
    return value;
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
  publish(null);
  lastRefreshAt = 0;
}
