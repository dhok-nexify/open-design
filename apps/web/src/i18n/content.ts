import type {
  DesignSystemSummary,
  PromptTemplateSummary,
  SkillSummary,
} from '../types';
import type { Locale } from './types';
import { interpolateMessage, notifyI18nDataLoaded } from './index';
import {
  ZH_CN_DESIGN_SYSTEM_CATEGORIES,
  ZH_CN_DESIGN_SYSTEM_SUMMARIES,
  ZH_CN_PROMPT_TEMPLATE_CATEGORIES,
  ZH_CN_PROMPT_TEMPLATE_COPY,
  ZH_CN_PROMPT_TEMPLATE_TAGS,
  ZH_CN_SKILL_COPY,
} from './content.zh-CN';

type LocalizedSkillCopy = { description?: string; examplePrompt?: string };
type LocalizedPromptTemplateCopy = Partial<Pick<PromptTemplateSummary, 'summary' | 'title'>>;
type LocalizedContentIds = {
  skills: string[];
  designSystems: string[];
  designSystemCategories: string[];
  promptTemplates: string[];
  promptTemplateCategories: string[];
  promptTemplateTags: string[];
};
type LocalizedContentBundle = {
  skillCopy: Record<string, LocalizedSkillCopy>;
  designSystemSummaries: Record<string, string>;
  designSystemCategories: Record<string, string>;
  promptTemplateCategories: Record<string, string>;
  promptTemplateTags: Record<string, string>;
  promptTemplateCopy: Record<string, LocalizedPromptTemplateCopy>;
};

// Built-in content bundles that stay in the main chunk. zh-CN also backs the
// zh-TW script fallback; every other locale is split into its own chunk and
// fetched on first use (perf round 2: this table used to ship ~6.1 MB of
// translated skill / design-system / template copy to every visitor).
const EAGER_LOCALIZED_CONTENT: Partial<Record<Locale, LocalizedContentBundle>> = {
  'zh-CN': {
    skillCopy: ZH_CN_SKILL_COPY,
    designSystemSummaries: ZH_CN_DESIGN_SYSTEM_SUMMARIES,
    designSystemCategories: ZH_CN_DESIGN_SYSTEM_CATEGORIES,
    promptTemplateCategories: ZH_CN_PROMPT_TEMPLATE_CATEGORIES,
    promptTemplateTags: ZH_CN_PROMPT_TEMPLATE_TAGS,
    promptTemplateCopy: ZH_CN_PROMPT_TEMPLATE_COPY,
  },
};

type ContentLoader = () => Promise<LocalizedContentBundle>;

const CONTENT_LOADERS: Partial<Record<Locale, ContentLoader>> = {
  'de': () => import('./content.de').then((m) => ({
    skillCopy: m.DE_SKILL_COPY,
    designSystemSummaries: m.DE_DESIGN_SYSTEM_SUMMARIES,
    designSystemCategories: m.DE_DESIGN_SYSTEM_CATEGORIES,
    promptTemplateCategories: m.DE_PROMPT_TEMPLATE_CATEGORIES,
    promptTemplateTags: m.DE_PROMPT_TEMPLATE_TAGS,
    promptTemplateCopy: m.DE_PROMPT_TEMPLATE_COPY,
  })),
  'ru': () => import('./content.ru').then((m) => ({
    skillCopy: m.RU_SKILL_COPY,
    designSystemSummaries: m.RU_DESIGN_SYSTEM_SUMMARIES,
    designSystemCategories: m.RU_DESIGN_SYSTEM_CATEGORIES,
    promptTemplateCategories: m.RU_PROMPT_TEMPLATE_CATEGORIES,
    promptTemplateTags: m.RU_PROMPT_TEMPLATE_TAGS,
    promptTemplateCopy: m.RU_PROMPT_TEMPLATE_COPY,
  })),
  'fr': () => import('./content.fr').then((m) => ({
    skillCopy: m.FR_SKILL_COPY,
    designSystemSummaries: m.FR_DESIGN_SYSTEM_SUMMARIES,
    designSystemCategories: m.FR_DESIGN_SYSTEM_CATEGORIES,
    promptTemplateCategories: m.FR_PROMPT_TEMPLATE_CATEGORIES,
    promptTemplateTags: m.FR_PROMPT_TEMPLATE_TAGS,
    promptTemplateCopy: m.FR_PROMPT_TEMPLATE_COPY,
  })),
  'ja': () => import('./content.ja').then((m) => ({
    skillCopy: m.JA_SKILL_COPY,
    designSystemSummaries: m.JA_DESIGN_SYSTEM_SUMMARIES,
    designSystemCategories: m.JA_DESIGN_SYSTEM_CATEGORIES,
    promptTemplateCategories: m.JA_PROMPT_TEMPLATE_CATEGORIES,
    promptTemplateTags: m.JA_PROMPT_TEMPLATE_TAGS,
    promptTemplateCopy: m.JA_PROMPT_TEMPLATE_COPY,
  })),
  'id': () => import('./content.id').then((m) => ({
    skillCopy: m.ID_SKILL_COPY,
    designSystemSummaries: m.ID_DESIGN_SYSTEM_SUMMARIES,
    designSystemCategories: m.ID_DESIGN_SYSTEM_CATEGORIES,
    promptTemplateCategories: m.ID_PROMPT_TEMPLATE_CATEGORIES,
    promptTemplateTags: m.ID_PROMPT_TEMPLATE_TAGS,
    promptTemplateCopy: m.ID_PROMPT_TEMPLATE_COPY,
  })),
  'es-ES': () => import('./content.es-ES').then((m) => ({
    skillCopy: m.ES_ES_SKILL_COPY,
    designSystemSummaries: m.ES_ES_DESIGN_SYSTEM_SUMMARIES,
    designSystemCategories: m.ES_ES_DESIGN_SYSTEM_CATEGORIES,
    promptTemplateCategories: m.ES_ES_PROMPT_TEMPLATE_CATEGORIES,
    promptTemplateTags: m.ES_ES_PROMPT_TEMPLATE_TAGS,
    promptTemplateCopy: m.ES_ES_PROMPT_TEMPLATE_COPY,
  })),
  'pt-BR': () => import('./content.pt-BR').then((m) => ({
    skillCopy: m.PT_BR_SKILL_COPY,
    designSystemSummaries: m.PT_BR_DESIGN_SYSTEM_SUMMARIES,
    designSystemCategories: m.PT_BR_DESIGN_SYSTEM_CATEGORIES,
    promptTemplateCategories: m.PT_BR_PROMPT_TEMPLATE_CATEGORIES,
    promptTemplateTags: m.PT_BR_PROMPT_TEMPLATE_TAGS,
    promptTemplateCopy: m.PT_BR_PROMPT_TEMPLATE_COPY,
  })),
  'ar': () => import('./content.ar').then((m) => ({
    skillCopy: m.AR_SKILL_COPY,
    designSystemSummaries: m.AR_DESIGN_SYSTEM_SUMMARIES,
    designSystemCategories: m.AR_DESIGN_SYSTEM_CATEGORIES,
    promptTemplateCategories: m.AR_PROMPT_TEMPLATE_CATEGORIES,
    promptTemplateTags: m.AR_PROMPT_TEMPLATE_TAGS,
    promptTemplateCopy: m.AR_PROMPT_TEMPLATE_COPY,
  })),
  'fa': () => import('./content.fa').then((m) => ({
    skillCopy: m.FA_SKILL_COPY,
    designSystemSummaries: m.FA_DESIGN_SYSTEM_SUMMARIES,
    designSystemCategories: m.FA_DESIGN_SYSTEM_CATEGORIES,
    promptTemplateCategories: m.FA_PROMPT_TEMPLATE_CATEGORIES,
    promptTemplateTags: m.FA_PROMPT_TEMPLATE_TAGS,
    promptTemplateCopy: m.FA_PROMPT_TEMPLATE_COPY,
  })),
  'ko': () => import('./content.ko').then((m) => ({
    skillCopy: m.KO_SKILL_COPY,
    designSystemSummaries: m.KO_DESIGN_SYSTEM_SUMMARIES,
    designSystemCategories: m.KO_DESIGN_SYSTEM_CATEGORIES,
    promptTemplateCategories: m.KO_PROMPT_TEMPLATE_CATEGORIES,
    promptTemplateTags: m.KO_PROMPT_TEMPLATE_TAGS,
    promptTemplateCopy: m.KO_PROMPT_TEMPLATE_COPY,
  })),
  'pl': () => import('./content.pl').then((m) => ({
    skillCopy: m.PL_SKILL_COPY,
    designSystemSummaries: m.PL_DESIGN_SYSTEM_SUMMARIES,
    designSystemCategories: m.PL_DESIGN_SYSTEM_CATEGORIES,
    promptTemplateCategories: m.PL_PROMPT_TEMPLATE_CATEGORIES,
    promptTemplateTags: m.PL_PROMPT_TEMPLATE_TAGS,
    promptTemplateCopy: m.PL_PROMPT_TEMPLATE_COPY,
  })),
  'hu': () => import('./content.hu').then((m) => ({
    skillCopy: m.HU_SKILL_COPY,
    designSystemSummaries: m.HU_DESIGN_SYSTEM_SUMMARIES,
    designSystemCategories: m.HU_DESIGN_SYSTEM_CATEGORIES,
    promptTemplateCategories: m.HU_PROMPT_TEMPLATE_CATEGORIES,
    promptTemplateTags: m.HU_PROMPT_TEMPLATE_TAGS,
    promptTemplateCopy: m.HU_PROMPT_TEMPLATE_COPY,
  })),
  'uk': () => import('./content.uk').then((m) => ({
    skillCopy: m.UK_SKILL_COPY,
    designSystemSummaries: m.UK_DESIGN_SYSTEM_SUMMARIES,
    designSystemCategories: m.UK_DESIGN_SYSTEM_CATEGORIES,
    promptTemplateCategories: m.UK_PROMPT_TEMPLATE_CATEGORIES,
    promptTemplateTags: m.UK_PROMPT_TEMPLATE_TAGS,
    promptTemplateCopy: m.UK_PROMPT_TEMPLATE_COPY,
  })),
  'tr': () => import('./content.tr').then((m) => ({
    skillCopy: m.TR_SKILL_COPY,
    designSystemSummaries: m.TR_DESIGN_SYSTEM_SUMMARIES,
    designSystemCategories: m.TR_DESIGN_SYSTEM_CATEGORIES,
    promptTemplateCategories: m.TR_PROMPT_TEMPLATE_CATEGORIES,
    promptTemplateTags: m.TR_PROMPT_TEMPLATE_TAGS,
    promptTemplateCopy: m.TR_PROMPT_TEMPLATE_COPY,
  })),
  'th': () => import('./content.th').then((m) => ({
    skillCopy: m.TH_SKILL_COPY,
    designSystemSummaries: m.TH_DESIGN_SYSTEM_SUMMARIES,
    designSystemCategories: m.TH_DESIGN_SYSTEM_CATEGORIES,
    promptTemplateCategories: m.TH_PROMPT_TEMPLATE_CATEGORIES,
    promptTemplateTags: m.TH_PROMPT_TEMPLATE_TAGS,
    promptTemplateCopy: m.TH_PROMPT_TEMPLATE_COPY,
  })),
  'it': () => import('./content.it').then((m) => ({
    skillCopy: m.IT_SKILL_COPY,
    designSystemSummaries: m.IT_DESIGN_SYSTEM_SUMMARIES,
    designSystemCategories: m.IT_DESIGN_SYSTEM_CATEGORIES,
    promptTemplateCategories: m.IT_PROMPT_TEMPLATE_CATEGORIES,
    promptTemplateTags: m.IT_PROMPT_TEMPLATE_TAGS,
    promptTemplateCopy: m.IT_PROMPT_TEMPLATE_COPY,
  })),
};

const loadedContent = new Map<Locale, LocalizedContentBundle>(
  Object.entries(EAGER_LOCALIZED_CONTENT) as Array<[Locale, LocalizedContentBundle]>,
);
const pendingContent = new Map<Locale, Promise<void>>();

/**
 * Resolve one locale's built-in content bundle, loading its chunk on first use.
 * Concurrent callers share the in-flight promise. Until the bundle lands the
 * lookup helpers fall back to the English source fields they were given.
 */
export function ensureLocalizedContent(locale: Locale): Promise<void> {
  if (loadedContent.has(locale)) return Promise.resolve();
  const pending = pendingContent.get(locale);
  if (pending) return pending;
  const loader = CONTENT_LOADERS[locale];
  if (!loader) return Promise.resolve();
  const promise = loader()
    .then((bundle) => {
      loadedContent.set(locale, bundle);
      notifyI18nDataLoaded();
    })
    .finally(() => {
      pendingContent.delete(locale);
    });
  pendingContent.set(locale, promise);
  return promise;
}


function buildLocalizedContentIds(content: LocalizedContentBundle): LocalizedContentIds {
  return {
    skills: Object.keys(content.skillCopy),
    designSystems: Object.keys(content.designSystemSummaries),
    designSystemCategories: Object.keys(content.designSystemCategories),
    promptTemplates: Object.keys(content.promptTemplateCopy),
    promptTemplateCategories: Object.keys(content.promptTemplateCategories),
    promptTemplateTags: Object.keys(content.promptTemplateTags),
  };
}

/**
 * Localized ids for one locale's built-in content, or undefined while its chunk
 * is still loading. Callers that need a stable answer should await
 * `ensureLocalizedContent(locale)` first.
 */
export function getLocalizedContentIds(locale: Locale): LocalizedContentIds | undefined {
  const content = getLocalizedContent(locale);
  return content ? buildLocalizedContentIds(content) : undefined;
}

// True when a locale can resolve a built-in-content bundle — either a loaded
// bundle, an intentional script fallback (zh-TW -> zh-CN), or a chunk that is
// available to load on demand. When false, built-in skill / design-system /
// prompt-template copy renders in English for that locale.
export function hasLocalizedContent(locale: Locale): boolean {
  if (loadedContent.has(locale)) return true;
  if (locale.startsWith('zh')) return loadedContent.has('zh-CN');
  return CONTENT_LOADERS[locale] !== undefined;
}

function getLocalizedContent(locale: Locale): LocalizedContentBundle | undefined {
  const direct = loadedContent.get(locale);
  if (direct) return direct;
  // Traditional Chinese reuses the Simplified Chinese content tables when no
  // dedicated zh-TW bundle exists, matching the zh fallback in
  // `localizedRecordValue` so built-in content stays Chinese instead of
  // silently rendering English.
  if (locale.startsWith('zh')) return loadedContent.get('zh-CN');
  // Kick off the chunk here so a render that needs localized copy is the only
  // trigger required; the i18n provider re-renders consumers when it lands.
  if (CONTENT_LOADERS[locale] && typeof window !== 'undefined') {
    void ensureLocalizedContent(locale);
  }
  return undefined;
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function localizedRecordValue(
  locale: Locale,
  values: Record<string, string> | undefined,
  options: { includeEnglishFallback?: boolean } = {},
): string | undefined {
  if (!values) return undefined;
  if (values[locale]) return values[locale];
  if (locale === 'zh-TW' && values['zh-CN']) return values['zh-CN'];
  if (locale.startsWith('zh') && values['zh-CN']) return values['zh-CN'];
  if (options.includeEnglishFallback !== false && values.en) return values.en;
  return undefined;
}

export function localizeSkillName(locale: Locale, skill: SkillSummary): string {
  return localizedRecordValue(locale, skill.displayName) ?? skill.name;
}

export function localizeSkillPrompt(locale: Locale, skill: SkillSummary): string | undefined {
  const inline = localizedRecordValue(locale, skill.examplePromptI18n, {
    includeEnglishFallback: false,
  });
  if (inline) return inline;
  const translated = getLocalizedContent(locale)?.skillCopy[skill.id]?.examplePrompt;
  if (translated) return translated;
  const fallback = localizedRecordValue(locale, skill.examplePromptI18n);
  if (fallback) return fallback;
  return skill.examplePrompt ? normalizeText(skill.examplePrompt) : undefined;
}

export function localizeSkillDescription(locale: Locale, skill: SkillSummary): string {
  const inline = localizedRecordValue(locale, skill.descriptionI18n, {
    includeEnglishFallback: false,
  });
  if (inline) return interpolateMessage(inline);
  const translated = getLocalizedContent(locale)?.skillCopy[skill.id]?.description;
  if (translated) return interpolateMessage(translated);
  const fallback = localizedRecordValue(locale, skill.descriptionI18n);
  if (fallback) return interpolateMessage(fallback);
  return interpolateMessage(normalizeText(skill.description));
}

export function localizeDesignSystemSummary(
  locale: Locale,
  system: DesignSystemSummary,
): string {
  const translated = getLocalizedContent(locale)?.designSystemSummaries[system.id];
  if (translated) return translated;
  return system.summary || system.category || '';
}

export function localizeDesignSystemCategory(locale: Locale, category: string): string {
  return getLocalizedContent(locale)?.designSystemCategories[category] ?? category;
}

export function localizePromptTemplateCategory(locale: Locale, category: string): string {
  return getLocalizedContent(locale)?.promptTemplateCategories[category] ?? category;
}

export function localizePromptTemplateSummary(
  locale: Locale,
  template: PromptTemplateSummary,
): PromptTemplateSummary {
  const content = getLocalizedContent(locale);
  if (!content) return template;
  const translated = content.promptTemplateCopy[template.id];
  const tags = template.tags?.map((tag) => content.promptTemplateTags[tag] ?? tag);
  return {
    ...template,
    title: translated?.title ?? template.title,
    summary: translated?.summary ?? template.summary,
    category: localizePromptTemplateCategory(locale, template.category || 'General'),
    tags,
  };
}
