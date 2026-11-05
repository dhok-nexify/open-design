import { OFFLINE_FONT_WHITELIST } from '@open-design/contracts';

/**
 * Maps an arbitrary requested family onto the offline whitelist (DESIGN §13.3).
 *
 * The NexTore edition has no Google Fonts, so brand artifacts and previews must name a family the
 * deployment can render. Exact names win; common aliases are recognised; otherwise a coarse
 * category heuristic (mono / serif / CJK / display / script / sans) picks the closest whitelist
 * family. Every stack ends in host-installed fallbacks so a missing vendored file still renders.
 */
export type OfflineFontFamily = (typeof OFFLINE_FONT_WHITELIST)[number];

const SYSTEM_FALLBACKS: Record<OfflineFontFamily, readonly string[]> = {
  Inter: ['system-ui', 'sans-serif'],
  'Inter Tight': ['Inter', 'system-ui', 'sans-serif'],
  'Source Serif 4': ['Georgia', 'serif'],
  'Playfair Display': ['Georgia', 'serif'],
  'Space Grotesk': ['system-ui', 'sans-serif'],
  'JetBrains Mono': ['ui-monospace', 'monospace'],
  'Noto Sans HK': ['PingFang HK', 'Microsoft JhengHei', 'sans-serif'],
  'Noto Serif HK': ['PingFang HK', 'Songti TC', 'serif'],
  'Noto Sans SC': ['PingFang SC', 'Microsoft YaHei', 'sans-serif'],
  'Noto Serif SC': ['Songti SC', 'SimSun', 'serif'],
};

const ALIASES: Record<string, OfflineFontFamily> = {
  'inter display': 'Inter',
  'inter var': 'Inter',
  intervariable: 'Inter',
  'source serif': 'Source Serif 4',
  'source serif pro': 'Source Serif 4',
  playfair: 'Playfair Display',
  'jetbrains mono nl': 'JetBrains Mono',
  'noto sans': 'Noto Sans SC',
  'noto serif': 'Noto Serif SC',
  'noto sans tc': 'Noto Sans HK',
  'noto serif tc': 'Noto Serif HK',
  'noto sans cjk sc': 'Noto Sans SC',
  'noto serif cjk sc': 'Noto Serif SC',
};

const CJK_TRADITIONAL = /\b(hk|tc|hant|traditional|pingfang hk|jhenghei)\b/i;
const CJK_SIMPLIFIED = /\b(sc|cn|hans|simplified|pingfang sc|yahei|songti)\b/i;
const SERIF = /\bserif\b|georgia|times|garamond|baskerville|merriweather|lora|crimson|instrument/i;
const MONO = /\bmono\b|\bcode\b|console|typewriter|menlo|consolas|monaco|courier/i;
const DISPLAY = /\bdisplay\b|\bheadline\b|condensed|archivo|anton|oswald|bebas/i;
const SCRIPT = /\bscript\b|hand|casual|cursive|caveat|patrick/i;

export function mapToOfflineFontFamily(requested: string | null | undefined): OfflineFontFamily {
  const raw = (requested ?? '').trim().replace(/^['"]+|['"]+$/g, '');
  if (!raw) return 'Inter';

  const key = raw.toLowerCase();
  for (const family of OFFLINE_FONT_WHITELIST) {
    if (family.toLowerCase() === key) return family;
  }
  const alias = ALIASES[key];
  if (alias) return alias;

  if (MONO.test(key)) return 'JetBrains Mono';

  const serif = SERIF.test(key);
  if (CJK_TRADITIONAL.test(key)) return serif ? 'Noto Serif HK' : 'Noto Sans HK';
  if (CJK_SIMPLIFIED.test(key)) return serif ? 'Noto Serif SC' : 'Noto Sans SC';
  if (serif) return 'Source Serif 4';
  if (SCRIPT.test(key)) return 'Playfair Display';
  if (DISPLAY.test(key)) return 'Space Grotesk';
  return 'Inter';
}

function quote(family: string): string {
  return /^[a-zA-Z0-9-]+$/.test(family) ? family : "'" + family.replace(/'/g, '') + "'";
}

/** The whitelist family plus host fallbacks, ready for a CSS `font-family` value. */
export function offlineFontStack(requested: string | null | undefined): string {
  const family = mapToOfflineFontFamily(requested);
  return [family, ...SYSTEM_FALLBACKS[family]].map(quote).join(', ');
}
