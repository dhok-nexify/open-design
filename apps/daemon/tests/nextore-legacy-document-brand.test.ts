import { describe, expect, it } from 'vitest';

import { replaceLegacyDocumentTemplateBrand } from '../src/nextore/legacy-document-brand.js';

const BRAND = 'NexTore Designer';

describe('replaceLegacyDocumentTemplateBrand', () => {
  it.each([
    [
      'English, compact spelling',
      'Describe what OpenDesign should generate, edit, or decide from this document.',
      'Describe what NexTore Designer should generate, edit, or decide from this document.',
    ],
    [
      'English, spaced spelling',
      'Describe what Open Design should generate, edit, or decide from this document.',
      'Describe what NexTore Designer should generate, edit, or decide from this document.',
    ],
    [
      'English agent sentence',
      'The OpenDesign agent can read, edit, and use this file as project context.',
      'The NexTore Designer agent can read, edit, and use this file as project context.',
    ],
    [
      'English next step',
      'Review and edit this document, then ask Open Design to generate, revise, or operate from it.',
      'Review and edit this document, then ask NexTore Designer to generate, revise, or operate from it.',
    ],
    [
      'Simplified Chinese goal',
      '说明希望 OpenDesign 基于这份文档生成、修改或判断什么。',
      '说明希望 NexTore Designer 基于这份文档生成、修改或判断什么。',
    ],
    [
      'Simplified Chinese agent',
      'Open Design agent 可以读取、编辑这份文件，并把它作为项目上下文。',
      'NexTore Designer agent 可以读取、编辑这份文件，并把它作为项目上下文。',
    ],
    [
      'Simplified Chinese next step',
      '检查并编辑这份文档，然后让 OpenDesign 基于它生成、修改或执行操作。',
      '检查并编辑这份文档，然后让 NexTore Designer 基于它生成、修改或执行操作。',
    ],
    [
      'Traditional Chinese goal',
      '說明希望 OpenDesign 基於這份文件生成、修改或判斷什麼。',
      '說明希望 NexTore Designer 基於這份文件生成、修改或判斷什麼。',
    ],
    [
      'Traditional Chinese agent',
      'Open Design agent 可以讀取、編輯這份檔案，並把它作為專案上下文。',
      'NexTore Designer agent 可以讀取、編輯這份檔案，並把它作為專案上下文。',
    ],
    [
      'Traditional Chinese next step',
      '檢查並編輯這份文件，然後讓 OpenDesign 基於它生成、修改或執行操作。',
      '檢查並編輯這份文件，然後讓 NexTore Designer 基於它生成、修改或執行操作。',
    ],
  ])('migrates the known %s template phrase', (_label, input, expected) => {
    expect(replaceLegacyDocumentTemplateBrand(input, BRAND)).toBe(expected);
  });

  it('migrates every template phrase in a full legacy document', () => {
    const legacy = [
      '# Document',
      '',
      '## Goal',
      '',
      '说明希望 OpenDesign 基于这份文档生成、修改或判断什么。',
      '',
      '## How to use this document',
      '',
      '- OpenDesign agent 可以读取、编辑这份文件，并把它作为项目上下文。',
      '',
      '## Next step',
      '',
      '检查并编辑这份文档，然后让 OpenDesign 基于它生成、修改或执行操作。',
      '',
    ].join('\n');

    const migrated = replaceLegacyDocumentTemplateBrand(legacy, BRAND);

    expect(migrated).not.toContain('OpenDesign');
    expect(migrated.match(/NexTore Designer/g)).toHaveLength(3);
    expect(migrated).toContain('# Document');
    expect(migrated).toContain('## Next step');
  });

  it('leaves ordinary prose that mentions the product untouched', () => {
    const text = [
      '# OpenDesign notes',
      '',
      'OpenDesign is the upstream project. Our deployment is branded separately.',
      '',
      'The OpenDesign agent can read files, but this sentence is user prose.',
    ].join('\n');

    expect(replaceLegacyDocumentTemplateBrand(text, BRAND)).toBe(text);
  });

  it('leaves document text without a legacy product name untouched', () => {
    const text = '# Plan\n\nWrite the launch checklist.';
    expect(replaceLegacyDocumentTemplateBrand(text, BRAND)).toBe(text);
  });

  it('leaves the text untouched when the brand name is blank', () => {
    const text = 'Describe what OpenDesign should generate, edit, or decide from this document.';
    expect(replaceLegacyDocumentTemplateBrand(text, '   ')).toBe(text);
  });

  it('does not rewrite a phrase that already refers to the configured brand', () => {
    const text = 'Describe what NexTore Designer should generate, edit, or decide from this document.';
    expect(replaceLegacyDocumentTemplateBrand(text, BRAND)).toBe(text);
  });
});
