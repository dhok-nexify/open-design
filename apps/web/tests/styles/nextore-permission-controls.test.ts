// The permission drawer lives inside the shared `modal` chrome, where two
// global rules fight native checkboxes: `.modal label` (mention-home.css) makes
// every label a column, and `input` (primitives.css) gives every field 100%
// width plus text-field padding. Both are global, so the drawer has to
// out-specify them explicitly — a regression here stacks each checkbox above
// its label and paints it as a grey input box (walkthrough 2026-11-18).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(
  new URL('../../src/nextore/ProjectPermissionsDialog.module.css', import.meta.url),
  'utf8',
);

function declarations(selector: string): string {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rulePattern = /([^{}]+)\{([^}]*)\}/g;
  const blocks: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = rulePattern.exec(withoutComments)) !== null) {
    const selectors = (match[1] ?? '').split(',').map((item) => item.trim());
    if (selectors.includes(selector)) blocks.push(match[2] ?? '');
  }
  return blocks.join('\n');
}

const ROW_SELECTORS = [
  ':global(.modal) label.inlineCheck',
  ':global(.modal) label.treeLabel',
  ':global(.modal) label.memberRow',
];

const CHECKBOX_SELECTORS = [
  ".dialog input[type='checkbox']",
  ".pickerDialog input[type='checkbox']",
];

describe('NexTore permission drawer controls', () => {
  it('keeps the inline rows horizontal against the global modal label rule', () => {
    for (const selector of ROW_SELECTORS) {
      const block = declarations(selector);
      expect(block, selector).toMatch(/flex-direction:\s*row/);
      expect(block, selector).toMatch(/color:\s*var\(--text\)/);
      expect(block, selector).toMatch(/font-size:\s*13px/);
    }
  });

  it('strips text-field chrome from the drawer checkboxes', () => {
    for (const selector of CHECKBOX_SELECTORS) {
      const block = declarations(selector);
      expect(block, selector).toMatch(/width:\s*auto/);
      expect(block, selector).toMatch(/padding:\s*0/);
      expect(block, selector).toMatch(/border:\s*0/);
      expect(block, selector).toMatch(/background:\s*transparent/);
      expect(block, selector).toMatch(/accent-color:\s*var\(--nexTore-brand-primary, #4f46e5\)/);
    }
  });
});
