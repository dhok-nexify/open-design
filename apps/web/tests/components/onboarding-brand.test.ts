import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (relative: string) =>
  readFileSync(new URL(relative, import.meta.url), 'utf8');

// Both onboarding surfaces (cloud welcome and invite) render the year + brand
// footer. Upstream moved the invite footer into InviteDialog, so the contract is
// asserted per surface instead of twice inside EntryShell.
const brandedFooterSurfaces = [
  read('../../src/components/EntryShell.tsx'),
  read('../../src/components/InviteDialog.tsx'),
];
const librarySectionSource = read('../../src/components/LibrarySection.tsx');

describe('onboarding brand surfaces', () => {
  it('brands both onboarding footers through the shared brand slot', () => {
    for (const source of brandedFooterSurfaces) {
      // EntryShell renders `{t('app.brand')}` in JSX; InviteDialog builds the
      // same footer inside a template literal. Both must resolve the brand.
      expect(source).toMatch(/©[^\n]{0,40}new Date\(\)\.getFullYear\(\)[^\n]{0,80}app\.brand/);
      expect(source).not.toMatch(/OpenDesign · \{t\('settings\.onboardingCloudRights'\)\}/);
      expect(source).not.toMatch(/OpenDesign · \$\{t\('settings\.onboardingCloudRights'\)\}/);
    }
  });

  it('does not send users to the retired upstream clipper page', () => {
    expect(librarySectionSource).not.toContain('open-design.ai/clipper');
    expect(librarySectionSource).toContain('http://www.nexify.com.hk/');
  });
});
