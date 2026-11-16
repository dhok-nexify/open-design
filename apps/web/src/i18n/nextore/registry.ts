// Locale registry: binds each upstream dictionary to its downstream overlay.
//
// Upstream locale files stay byte-identical to upstream, so a sync never
// conflicts on translations. Eager locales are merged statically; every other
// locale imports its overlay lazily from the same chunk as its dictionary.

import type { Dict, Locale } from '../types';
import { withOverlay } from './merge';

import { en as enBase } from '../locales/en';
import { enOverlay, enBrandMaskedKeys } from './locales/en';
import { zhCN as zhCNBase } from '../locales/zh-CN';
import { zhCNOverlay, zhCNBrandMaskedKeys } from './locales/zh-CN';
import { zhTW as zhTWBase } from '../locales/zh-TW';
import { zhTWOverlay, zhTWBrandMaskedKeys } from './locales/zh-TW';

export const enDict: Dict = withOverlay(enBase, enOverlay, enBrandMaskedKeys);
export const zhCNDict: Dict = withOverlay(zhCNBase, zhCNOverlay, zhCNBrandMaskedKeys);
export const zhTWDict: Dict = withOverlay(zhTWBase, zhTWOverlay, zhTWBrandMaskedKeys);

export const eagerDicts: Partial<Record<Locale, Dict>> = {
  en: enDict,
  'zh-CN': zhCNDict,
  'zh-TW': zhTWDict,
};

type DictLoader = () => Promise<Dict>;

export const dictLoaders: Partial<Record<Locale, DictLoader>> = {
  id: () => Promise.all([import('../locales/id'), import('./locales/id')])
    .then(([base, overlay]) => withOverlay(base.id, overlay.idOverlay, overlay.idBrandMaskedKeys)),
  de: () => Promise.all([import('../locales/de'), import('./locales/de')])
    .then(([base, overlay]) => withOverlay(base.de, overlay.deOverlay, overlay.deBrandMaskedKeys)),
  'pt-BR': () => Promise.all([import('../locales/pt-BR'), import('./locales/pt-BR')])
    .then(([base, overlay]) => withOverlay(base.ptBR, overlay.ptBROverlay, overlay.ptBRBrandMaskedKeys)),
  'es-ES': () => Promise.all([import('../locales/es-ES'), import('./locales/es-ES')])
    .then(([base, overlay]) => withOverlay(base.esES, overlay.esESOverlay, overlay.esESBrandMaskedKeys)),
  ru: () => Promise.all([import('../locales/ru'), import('./locales/ru')])
    .then(([base, overlay]) => withOverlay(base.ru, overlay.ruOverlay, overlay.ruBrandMaskedKeys)),
  fa: () => Promise.all([import('../locales/fa'), import('./locales/fa')])
    .then(([base, overlay]) => withOverlay(base.fa, overlay.faOverlay, overlay.faBrandMaskedKeys)),
  ar: () => Promise.all([import('../locales/ar'), import('./locales/ar')])
    .then(([base, overlay]) => withOverlay(base.ar, overlay.arOverlay, overlay.arBrandMaskedKeys)),
  ja: () => Promise.all([import('../locales/ja'), import('./locales/ja')])
    .then(([base, overlay]) => withOverlay(base.ja, overlay.jaOverlay, overlay.jaBrandMaskedKeys)),
  ko: () => Promise.all([import('../locales/ko'), import('./locales/ko')])
    .then(([base, overlay]) => withOverlay(base.ko, overlay.koOverlay, overlay.koBrandMaskedKeys)),
  pl: () => Promise.all([import('../locales/pl'), import('./locales/pl')])
    .then(([base, overlay]) => withOverlay(base.pl, overlay.plOverlay, overlay.plBrandMaskedKeys)),
  hu: () => Promise.all([import('../locales/hu'), import('./locales/hu')])
    .then(([base, overlay]) => withOverlay(base.hu, overlay.huOverlay, overlay.huBrandMaskedKeys)),
  fr: () => Promise.all([import('../locales/fr'), import('./locales/fr')])
    .then(([base, overlay]) => withOverlay(base.fr, overlay.frOverlay, overlay.frBrandMaskedKeys)),
  uk: () => Promise.all([import('../locales/uk'), import('./locales/uk')])
    .then(([base, overlay]) => withOverlay(base.uk, overlay.ukOverlay, overlay.ukBrandMaskedKeys)),
  tr: () => Promise.all([import('../locales/tr'), import('./locales/tr')])
    .then(([base, overlay]) => withOverlay(base.tr, overlay.trOverlay, overlay.trBrandMaskedKeys)),
  th: () => Promise.all([import('../locales/th'), import('./locales/th')])
    .then(([base, overlay]) => withOverlay(base.th, overlay.thOverlay, overlay.thBrandMaskedKeys)),
  it: () => Promise.all([import('../locales/it'), import('./locales/it')])
    .then(([base, overlay]) => withOverlay(base.it, overlay.itOverlay, overlay.itBrandMaskedKeys)),
};
