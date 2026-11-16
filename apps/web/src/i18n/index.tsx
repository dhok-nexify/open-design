'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { DEFAULT_PRODUCT_BRAND_NAME } from '@open-design/contracts';
import { en } from './locales/en';

const DEFAULT_BRAND_NAME = DEFAULT_PRODUCT_BRAND_NAME;
let brandName = DEFAULT_BRAND_NAME;

/**
 * The product name interpolated into every `{brandName}` placeholder (DESIGN §12.1).
 * The branding payload replaces the default after boot; a blank or missing name keeps the
 * bundled default so the UI never shows an empty product name.
 */
export function setBrandName(next: string | null | undefined): void {
  const trimmed = next?.trim();
  brandName = trimmed && trimmed.length > 0 ? trimmed : DEFAULT_BRAND_NAME;
}

export function getBrandName(): string {
  return brandName;
}

export function interpolateMessage(raw: string, vars?: Record<string, string | number>): string {
  return raw.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = vars?.[name] ?? (name === 'brandName' ? brandName : undefined);
    return value == null ? '{' + name + '}' : String(value);
  });
}
import { zhCN } from './locales/zh-CN';
import { zhTW } from './locales/zh-TW';
import { getOpenDesignHost } from '@open-design/host';
import { LOCALES, type Dict, type Locale } from './types';

export { LOCALES, LOCALE_LABEL } from './types';
export type { Locale } from './types';

type DictKey = keyof Dict;

type DictLoader = () => Promise<Dict>;

// Dictionaries that stay in the main client bundle. English is the fallback for
// every other locale; zh-CN and zh-TW are kept eager because they are the
// dominant UI languages for this deployment and swapping them in after paint
// would flash English at first render. Every other locale is split into its own
// chunk by the bundler and fetched only when that locale is selected (perf
// round 1: the eager map used to ship ~6.3 MB of translations to every visitor).
const EAGER_DICTS: Partial<Record<Locale, Dict>> = {
  'en': en,
  'zh-CN': zhCN,
  'zh-TW': zhTW,
};

const DICT_LOADERS: Partial<Record<Locale, DictLoader>> = {
  'id': () => import('./locales/id').then((m) => m.id),
  'de': () => import('./locales/de').then((m) => m.de),
  'pt-BR': () => import('./locales/pt-BR').then((m) => m.ptBR),
  'es-ES': () => import('./locales/es-ES').then((m) => m.esES),
  'ru': () => import('./locales/ru').then((m) => m.ru),
  'fa': () => import('./locales/fa').then((m) => m.fa),
  'ar': () => import('./locales/ar').then((m) => m.ar),
  'ja': () => import('./locales/ja').then((m) => m.ja),
  'ko': () => import('./locales/ko').then((m) => m.ko),
  'pl': () => import('./locales/pl').then((m) => m.pl),
  'hu': () => import('./locales/hu').then((m) => m.hu),
  'fr': () => import('./locales/fr').then((m) => m.fr),
  'uk': () => import('./locales/uk').then((m) => m.uk),
  'tr': () => import('./locales/tr').then((m) => m.tr),
  'th': () => import('./locales/th').then((m) => m.th),
  'it': () => import('./locales/it').then((m) => m.it),
};

const loadedDicts = new Map<Locale, Dict>(
  Object.entries(EAGER_DICTS) as Array<[Locale, Dict]>,
);
const pendingDicts = new Map<Locale, Promise<void>>();
const dictListeners = new Set<() => void>();

/**
 * Wake every consumer of lazily loaded i18n data (locale dictionaries and
 * built-in content bundles) so display strings can swap from the English
 * fallback to the requested locale once its chunk arrives.
 */
export function notifyI18nDataLoaded(): void {
  for (const listener of dictListeners) listener();
}

export function subscribeDictLoads(listener: () => void): () => void {
  dictListeners.add(listener);
  return () => {
    dictListeners.delete(listener);
  };
}

function dictFor(locale: Locale): Dict | undefined {
  return loadedDicts.get(locale);
}

/**
 * Resolve one locale's dictionary, loading its chunk on first use. Concurrent
 * callers share the in-flight promise so a language switch cannot fetch the
 * same chunk twice.
 */
export function ensureDict(locale: Locale): Promise<void> {
  if (loadedDicts.has(locale)) return Promise.resolve();
  const pending = pendingDicts.get(locale);
  if (pending) return pending;
  const loader = DICT_LOADERS[locale];
  if (!loader) return Promise.resolve();
  const promise = loader()
    .then((dict) => {
      loadedDicts.set(locale, dict);
      notifyI18nDataLoaded();
    })
    .finally(() => {
      pendingDicts.delete(locale);
    });
  pendingDicts.set(locale, promise);
  return promise;
}

const LS_KEY = 'open-design:locale';
// Marker that says "the value in LS_KEY came from a deliberate user
// action through setLocale, not from some auto-detection path". Only
// values tagged this way win over the desktop host's injected OS
// locale, so a stale auto-detected pick can't pin the app forever once
// the user changes their system language.
const LS_SOURCE_KEY = 'open-design:locale-source';
const MANUAL_LOCALE_SOURCE = 'manual';

export function resolveSystemLocale(languages: readonly string[]): Locale | null {
  const supported = LOCALES as readonly string[];
  for (const raw of languages) {
    const normalized = raw.trim();
    if (!normalized) continue;

    const exact = LOCALES.find((locale) => locale.toLowerCase() === normalized.toLowerCase());
    if (exact) return exact;

    const [language, regionOrScript] = normalized.toLowerCase().split('-');
    if (language === 'zh') {
      if (regionOrScript === 'hant' || regionOrScript === 'tw' || regionOrScript === 'hk' || regionOrScript === 'mo') {
        return 'zh-TW';
      }
      return 'zh-CN';
    }

    const baseMatch = LOCALES.find((locale) => locale.toLowerCase().split('-')[0] === language);
    if (baseMatch && supported.includes(baseMatch)) return baseMatch;
  }
  return null;
}

/**
 * A `t()` bound to an explicit content-language tag rather than the app UI
 * locale. Used by the question-form card so host-rendered strings inside the
 * card (the "Other" chip, custom-answer copy) match the language the model
 * localized the form into — a Chinese form in an English UI must not mix
 * scripts. Returns null when the tag doesn't resolve to a bundled locale;
 * callers fall back to the context `t`.
 */
export function tForLanguageTag(
  tag: string | undefined,
): ((key: DictKey, vars?: Record<string, string | number>) => string) | null {
  if (!tag || !tag.trim()) return null;
  const locale = resolveSystemLocale([tag]);
  if (!locale) return null;
  const dict = dictFor(locale);
  if (!dict) {
    void ensureDict(locale);
    return null;
  }
  return (key, vars) => {
    const raw = dict[key] ?? en[key] ?? key;
    return interpolateMessage(raw, vars);
  };
}

// Read the OS locale the desktop host attached to its client descriptor.
// Packaged desktop builds need this because Chromium otherwise reports
// en-US through navigator.language regardless of the OS setting. We go
// through `getOpenDesignHost` rather than reading the bridge global by
// name so the web/preload boundary stays single-source (see the
// `host bridge boundary` guard test).
function readDesktopHostOsLocale(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  const host = getOpenDesignHost();
  const value = host?.client?.osLocale;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

// First-run defaults to the user's OS / browser language when possible.
// Priority: explicit user pick saved to localStorage (only when tagged
// as manual) > OS locale that the desktop host injected (packaged
// Electron) > navigator.languages > 'en'. The source tag matters
// because untagged localStorage values are treated as legacy /
// auto-detected — they don't override a fresh OS locale read.
// Exported so tests can pin the priority chain without spinning up the
// full I18nProvider.
export function detectInitialLocale(): Locale {
  if (typeof window === 'undefined') return 'en';
  let storedLocale: string | null = null;
  let storedSource: string | null = null;
  try {
    storedLocale = window.localStorage.getItem(LS_KEY);
    storedSource = window.localStorage.getItem(LS_SOURCE_KEY);
  } catch {
    /* ignore */
  }
  if (
    storedSource === MANUAL_LOCALE_SOURCE &&
    storedLocale &&
    (LOCALES as string[]).includes(storedLocale)
  ) {
    return storedLocale as Locale;
  }
  const hostOsLocale = readDesktopHostOsLocale();
  if (hostOsLocale) {
    const fromHost = resolveSystemLocale([hostOsLocale]);
    if (fromHost) return fromHost;
  }
  const detected = resolveSystemLocale(
    navigator.languages?.length ? navigator.languages : [navigator.language],
  );
  return detected ?? 'en';
}

interface I18nContextValue {
  locale: Locale;
  setLocale: (next: Locale) => void;
  t: (key: DictKey, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

// Stand-alone English translator used when no provider is mounted (e.g. an
// isolated test). It MUST be a module-level singleton, not rebuilt per render:
// components legitimately list `t` in effect dependency arrays, and inside the
// provider `t` is identity-stable (useCallback on [locale]). A fresh closure
// here would break that contract only on the provider-less path, turning any
// such effect into an infinite render loop that spins instead of failing —
// which reads as a hung test suite rather than a bug.
const FALLBACK_I18N: I18nContextValue = {
  locale: 'en',
  setLocale: () => { },
  t: (key, vars) => {
    const raw = en[key] ?? key;
    return interpolateMessage(raw, vars);
  },
};

interface ProviderProps {
  initial?: Locale;
  children: ReactNode;
}

const RTL_LOCALES: Locale[] = ['ar', 'fa'];

/**
 * Whether a locale lays out right-to-left. Exported because direction also
 * flips side-anchored UI (the nav rail moves to the right edge, so its
 * tooltips have to open toward the left) and those callers must not
 * re-declare the locale list.
 */
export function isRtlLocale(locale: Locale): boolean {
  return RTL_LOCALES.includes(locale);
}

export function I18nProvider({ initial, children }: ProviderProps) {
  const [locale, setLocaleState] = useState<Locale>(() => initial ?? detectInitialLocale());
  // Bumped once an on-demand dictionary chunk resolves so the translator and
  // every consumer re-render with the loaded strings.
  const [dictVersion, setDictVersion] = useState(0);

  useEffect(() => {
    if (dictFor(locale)) return undefined;
    void ensureDict(locale);
    return undefined;
  }, [locale]);

  useEffect(() => subscribeDictLoads(() => setDictVersion((version) => version + 1)), []);

  // Keep <html lang="…" dir="…"> in sync so screen readers and CSS hooks
  // pick the right language token and direction without each component
  // having to set it itself.
  useEffect(() => {
    if (typeof document !== 'undefined') {
      const dir = isRtlLocale(locale) ? 'rtl' : 'ltr';
      document.documentElement.setAttribute('lang', locale);
      document.documentElement.setAttribute('dir', dir);
    }
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      window.localStorage.setItem(LS_KEY, next);
      // Marker so detectInitialLocale knows this came from a deliberate
      // user action and should beat the desktop host's OS locale.
      window.localStorage.setItem(LS_SOURCE_KEY, MANUAL_LOCALE_SOURCE);
    } catch {
      /* ignore */
    }
  }, []);

  const t = useCallback(
    (key: DictKey, vars?: Record<string, string | number>): string => {
      const dict = dictFor(locale);
      const raw = dict?.[key] ?? en[key] ?? key;
      return interpolateMessage(raw, vars);
    },
    // dictVersion is a dependency even though it is unread: loading a locale
    // chunk must invalidate this callback so consumers pick up new strings.
    [locale, dictVersion],
  );

  const value = useMemo<I18nContextValue>(
    () => ({ locale, setLocale, t }),
    [locale, setLocale, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  // Falling back keeps the API safe to call without requiring every callsite
  // to wrap in a provider. See FALLBACK_I18N on why it is a shared singleton.
  return useContext(I18nContext) ?? FALLBACK_I18N;
}

// Convenience for components that only need the translator function.
export function useT(): I18nContextValue['t'] {
  return useI18n().t;
}
