const LEGACY_PRODUCT_NAMES: ReadonlyArray<string> = ['OpenDesign', 'Open Design'];

/**
 * Exact sentences emitted by older blank-document templates. The product name
 * is kept as a `{product}` placeholder so every historical spelling can be
 * migrated without scanning for the product name on its own.
 */
const LEGACY_DOCUMENT_TEMPLATE_PHRASES: ReadonlyArray<readonly [string, string]> = [
  [
    'Describe what {product} should generate, edit, or decide from this document.',
    'Describe what {brandName} should generate, edit, or decide from this document.',
  ],
  [
    'The {product} agent can read, edit, and use this file as project context.',
    'The {brandName} agent can read, edit, and use this file as project context.',
  ],
  [
    'then ask {product} to generate, revise, or operate from it.',
    'then ask {brandName} to generate, revise, or operate from it.',
  ],
  [
    '说明希望 {product} 基于这份文档生成、修改或判断什么。',
    '说明希望 {brandName} 基于这份文档生成、修改或判断什么。',
  ],
  [
    '{product} agent 可以读取、编辑这份文件，并把它作为项目上下文。',
    '{brandName} agent 可以读取、编辑这份文件，并把它作为项目上下文。',
  ],
  [
    '检查并编辑这份文档，然后让 {product} 基于它生成、修改或执行操作。',
    '检查并编辑这份文档，然后让 {brandName} 基于它生成、修改或执行操作。',
  ],
  [
    '說明希望 {product} 基於這份文件生成、修改或判斷什麼。',
    '說明希望 {brandName} 基於這份文件生成、修改或判斷什麼。',
  ],
  [
    '{product} agent 可以讀取、編輯這份檔案，並把它作為專案上下文。',
    '{brandName} agent 可以讀取、編輯這份檔案，並把它作為專案上下文。',
  ],
  [
    '檢查並編輯這份文件，然後讓 {product} 基於它生成、修改或執行操作。',
    '檢查並編輯這份文件，然後讓 {brandName} 基於它生成、修改或執行操作。',
  ],
];

function expand(value: string, product: string, brandName: string): string {
  return value.split('{product}').join(product).split('{brandName}').join(brandName);
}

/**
 * Older blank-document files were written from a template that hardcoded the
 * upstream product name. Replace only the exact template phrases; arbitrary
 * user prose that mentions the product must remain untouched.
 */
export function replaceLegacyDocumentTemplateBrand(
  text: string,
  brandName: string,
): string {
  const resolved = brandName.trim();
  if (!resolved) return text;
  if (!LEGACY_PRODUCT_NAMES.some((name) => text.includes(name))) return text;
  let result = text;
  for (const [legacy, replacement] of LEGACY_DOCUMENT_TEMPLATE_PHRASES) {
    for (const product of LEGACY_PRODUCT_NAMES) {
      result = result
        .split(expand(legacy, product, resolved))
        .join(expand(replacement, product, resolved));
    }
  }
  return result;
}
