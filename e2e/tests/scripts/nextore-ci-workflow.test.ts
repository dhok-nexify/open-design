import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// NXD-D37: the fork's CI must keep gating the edition-specific surfaces even
// while upstream workflows are disabled in the repository settings. These
// checks pin the minimum gate set and the operator switch, so a future edit
// cannot silently drop guard/tests/image verification or re-enable upstream.

const repoRoot = join(import.meta.dirname, '../../..');
const workflowPath = join(repoRoot, '.github/workflows/nextore-ci.yml');
const disableScriptPath = join(repoRoot, '.github/scripts/nextore/disable-upstream-workflows.sh');

describe('nextore-ci workflow', () => {
  it('runs on nextore branches and manual dispatch', async () => {
    const workflow = await readFile(workflowPath, 'utf8');
    expect(workflow).toContain("branches:\n      - 'nextore/**'");
    expect(workflow).toContain('workflow_dispatch:');
  });

  it('keeps the repo-wide gates', async () => {
    const workflow = await readFile(workflowPath, 'utf8');
    for (const command of [
      'pnpm install --frozen-lockfile',
      'pnpm guard',
      'pnpm typecheck',
      'pnpm --filter @open-design/contracts test',
      'pnpm --filter @open-design/daemon test',
      'pnpm --filter @open-design/web test',
    ]) {
      expect(workflow, command).toContain(command);
    }
  });

  it('runs the offline edition e2e suite', async () => {
    const workflow = await readFile(workflowPath, 'utf8');
    expect(workflow).toContain('tests/offline-content-assets.test.ts');
    expect(workflow).toContain('tests/offline-render.test.ts');
  });

  it('builds the NexTore image and proves the sandbox works inside it', async () => {
    const workflow = await readFile(workflowPath, 'utf8');
    expect(workflow).toContain('docker build --file deploy/nextore/Dockerfile --tag nextore-designer:ci .');
    expect(workflow).toContain('seccomp=deploy/nextore/seccomp-bwrap.json');
    expect(workflow).toContain('--entrypoint /usr/bin/bwrap');
    expect(workflow).toContain('--unshare-pid');
    expect(workflow).toContain('apps/daemon/vendor/fonts@1.0.0/fonts.css');
  });

  it('runs the deployment artifact contract test', async () => {
    const workflow = await readFile(workflowPath, 'utf8');
    expect(workflow).toContain('deploy/tests/nextore-image.test.ts');
  });
});

describe('disable-upstream-workflows.sh', () => {
  it('is a dry run unless --apply is passed', async () => {
    const script = await readFile(disableScriptPath, 'utf8');
    expect(script).toContain('apply=0');
    expect(script).toContain('--apply) apply=1 ;;');
    expect(script).toContain('would disable');
    expect(script).toContain('gh workflow disable');
  });

  it('keeps the NexTore pipeline', async () => {
    const script = await readFile(disableScriptPath, 'utf8');
    expect(script).toContain('KEEP=("nextore-ci.yml")');
    expect(script).toContain('keep          $name');
  });
});
