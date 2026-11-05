import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Static contract for the NexTore Designer image (NXD-D35). A real build runs in
// CI; these checks catch the drift that would otherwise only surface there: a
// COPY that points at a file no longer in the repo, a sandbox that silently
// disappears from the image, or a seccomp profile that denies what bwrap needs.

const repoRoot = join(import.meta.dirname, '../..');
const deployDir = join(repoRoot, 'deploy/nextore');
const dockerfilePath = join(deployDir, 'Dockerfile');
const composePath = join(deployDir, 'compose.yml');
const seccompPath = join(deployDir, 'seccomp-bwrap.json');

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

test('Dockerfile pins the runtime, installs bubblewrap and runs unprivileged', async () => {
  const dockerfile = await readFile(dockerfilePath, 'utf8');

  assert.match(dockerfile, /^ARG OPENCODE_VERSION=1\.18\.18$/m);
  assert.match(dockerfile, /apt-get install[\s\S]*bubblewrap/);
  assert.match(dockerfile, /^USER designer$/m);
  assert.match(dockerfile, /^ENV OD_SANDBOX=bwrap$/m);
  assert.match(dockerfile, /^ENV OD_EDITION=nextore$/m);
  assert.match(dockerfile, /^ENV OD_BWRAP_BIN=\/usr\/bin\/bwrap$/m);
  assert.match(dockerfile, /^ENV OPENCODE_BIN=\/usr\/local\/bin\/opencode$/m);
  // Without the vendored assets /vendor/* answers 503.
  assert.match(dockerfile, /COPY --from=build [^\n]*\/app\/apps\/daemon\/vendor/);
});

test('Dockerfile uses LF so line continuations survive the checkout', async () => {
  const dockerfile = await readFile(dockerfilePath, 'utf8');
  assert.ok(!dockerfile.includes('\r'), 'Dockerfile must not contain CR');
});

test('every build-context COPY source exists', async () => {
  const dockerfile = await readFile(dockerfilePath, 'utf8');
  const sources = [...dockerfile.matchAll(/^COPY\s+(?!\/)(?:--\S+\s+)*([^\s]+)\s+\S+$/gm)]
    .map((match) => match[1])
    .filter((source) => !source.startsWith('/'));

  const missing: string[] = [];
  for (const source of sources) {
    if (!(await exists(join(repoRoot, source)))) missing.push(source);
  }
  assert.deepEqual(missing, []);
});

test('compose wires edition settings, the sandbox and the secret mount', async () => {
  const compose = await readFile(composePath, 'utf8');

  assert.match(compose, /OD_EDITION: nextore/);
  assert.match(compose, /OD_SANDBOX: \$\{DESIGNER_SANDBOX:-bwrap\}/);
  assert.match(compose, /DESIGNER_SECRET_FILE: \/run\/secrets\/designer_secret/);
  assert.match(compose, /seccomp=\.\/seccomp-bwrap\.json/);
  assert.match(compose, /designer_data:\/var\/lib\/designer/);
  assert.match(compose, /read_only: true/);
});

test('compose references deployment values through required substitutions', async () => {
  const compose = await readFile(composePath, 'utf8');
  for (const name of ['NEXTORE_BASE_URL', 'NEXTORE_OAUTH_CLIENT_ID', 'DESIGNER_BASE_URL']) {
    assert.match(compose, new RegExp(name + ': \\$\\{' + name + ':\\?[^}]*\\}'));
  }
});

test('the seccomp example allows namespaces and denies kernel-loading syscalls', async () => {
  const profile = JSON.parse(await readFile(seccompPath, 'utf8')) as {
    defaultAction: string;
    syscalls: Array<{ names: string[]; action: string }>;
  };

  assert.equal(profile.defaultAction, 'SCMP_ACT_ALLOW');
  const denied = new Set(profile.syscalls.flatMap((rule) => rule.names));

  for (const name of ['init_module', 'finit_module', 'kexec_load', 'bpf', 'ptrace', 'perf_event_open']) {
    assert.ok(denied.has(name), name + ' must be denied');
  }
  // bwrap needs these to build its namespace and mounts inside it.
  for (const name of ['unshare', 'clone', 'mount', 'setns', 'sethostname']) {
    assert.ok(!denied.has(name), name + ' must stay allowed for bubblewrap');
  }
});
