import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The brander lives in bin/nd.mjs and rewrites only command references, so this
// test sits on the output rather than on the source: an upstream help line that
// introduces a new `od …` usage is caught here instead of being renamed in
// cli.ts (where every future upstream change would conflict).
const daemonDir = join(__dirname, '..');
const distEntry = join(daemonDir, 'dist', 'cli.js');
const enabled = existsSync(distEntry);

function helpFrom(bin: 'od.mjs' | 'nd.mjs'): string {
  return execFileSync(process.execPath, [join(daemonDir, 'bin', bin), '--help'], {
    cwd: daemonDir,
    encoding: 'utf8',
    timeout: 30_000,
  });
}

describe('nd CLI branding', () => {
  it.skipIf(!enabled)('presents itself as nd and leaves no od command behind', () => {
    const output = helpFrom('nd.mjs');

    expect(output).toContain('nd [--port');
    // Any `od <something>` here means the brander missed a new usage line.
    expect(output).not.toMatch(/(^|\s)od\s/);
  });

  it.skipIf(!enabled)('keeps the upstream od entry unchanged', () => {
    const output = helpFrom('od.mjs');

    expect(output).toContain('od [--port');
    expect(output).not.toMatch(/(^|\s)nd\s/);
  });
});
