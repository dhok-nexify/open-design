import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const i18nDir = path.join(repoRoot, 'apps/web/src/i18n');
const upstreamLocalesDir = path.join(i18nDir, 'locales');
const overlayLocalesDir = path.join(i18nDir, 'nextore/locales');

function read(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function filesIn(directory: string): string[] {
  return readdirSync(directory).filter((file) => file.endsWith('.ts'));
}

const downstreamKeyPattern = /^(?:projectSpace|nextorePermissions)\./;

describe('Nextore i18n overlay ownership', () => {
  const nextoreTypes = read('apps/web/src/i18n/nextore/types.ts');
  const downstreamKeys = [...nextoreTypes.matchAll(/'([^']+)': string;/g)]
    .map((match) => match[1]!)
    .filter((key) => downstreamKeyPattern.test(key));

  it('keeps downstream keys out of upstream-owned dictionaries', () => {
    const upstreamSources = [
      ['apps/web/src/i18n/types.ts', read('apps/web/src/i18n/types.ts')] as const,
      ...filesIn(upstreamLocalesDir).map((file) => [
        'apps/web/src/i18n/locales/' + file,
        readFileSync(path.join(upstreamLocalesDir, file), 'utf8'),
      ] as const),
    ];

    expect(downstreamKeys.length).toBeGreaterThan(0);
    for (const [file, source] of upstreamSources) {
      for (const key of downstreamKeys) {
        expect(source, file + ' must not own ' + key).not.toContain(key);
      }
    }
  });

  it('defines every downstream key in NextoreDict and every overlay', () => {
    const overlayFiles = filesIn(overlayLocalesDir);

    expect(overlayFiles).toHaveLength(19);
    for (const key of downstreamKeys) {
      expect(nextoreTypes).toContain("'" + key + "'");
      for (const file of overlayFiles) {
        const source = readFileSync(path.join(overlayLocalesDir, file), 'utf8');
        expect(source, file + ' must define ' + key).toContain('"' + key + '"');
      }
    }
  });

  it('documents the ownership rule in AGENTS.md', () => {
    expect(read('AGENTS.md')).toContain('Nextore-only keys and overrides belong');
  });
});
