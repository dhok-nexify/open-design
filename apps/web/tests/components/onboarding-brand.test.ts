import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (relative: string) =>
  readFileSync(new URL(relative, import.meta.url), 'utf8');

const entryShellSource = read('../../src/components/EntryShell.tsx');
const librarySectionSource = read('../../src/components/LibrarySection.tsx');

describe('onboarding brand surfaces', () => {
  it('brands both onboarding footers through the shared brand slot', () => {
    const brandedFooters = entryShellSource.match(
      /© \{new Date\(\)\.getFullYear\(\)\} \{t\('app\.brand'\)\}/g,
    ) ?? [];

    expect(brandedFooters).toHaveLength(2);
    expect(entryShellSource).not.toMatch(/© \{new Date\(\)\.getFullYear\(\)\} OpenDesign/);
  });

  it('does not send users to the retired upstream clipper page', () => {
    expect(librarySectionSource).not.toContain('open-design.ai/clipper');
    expect(librarySectionSource).toContain('http://www.nexify.com.hk/');
  });
});
