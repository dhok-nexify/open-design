import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// NXD-D36 static contract for the Linux tarball installer, systemd unit and the
// host prerequisites it enforces. The scripts run with bash -n in CI and on a
// real host during acceptance; the checks here catch semantic drift that a syntax
// check cannot see (a unit that blocks bwrap, a secret baked into the tree, or
// the installer and image disagreeing on the pinned opencode version).

const repoRoot = join(import.meta.dirname, '../..');
const linuxDir = join(repoRoot, 'deploy/nextore/linux');

async function read(name: string): Promise<string> {
  return readFile(join(linuxDir, name), 'utf8');
}

test('installer and build script are LF shell scripts with strict mode', async () => {
  for (const name of ['install.sh', 'build-tarball.sh']) {
    const text = await read(name);
    assert.ok(text.startsWith('#!/usr/bin/env bash'), name + ' needs a bash shebang');
    assert.match(text, /^set -euo pipefail$/m);
    assert.ok(!text.includes('\r'), name + ' must use LF');
  }
});

test('installer refuses a host where bubblewrap cannot build a namespace', async () => {
  const install = await read('install.sh');
  assert.match(install, /unprivileged_userns_clone/);
  assert.match(install, /runuser -u "\$SERVICE_USER" -- bwrap/);
  assert.match(install, /--unshare-pid/);
  assert.match(install, /AppArmor/);
});

test('installer is idempotent for the env file and the secret', async () => {
  const install = await read('install.sh');
  assert.match(install, /if \[ ! -f "\$ENV_DIR\/designer\.env" \]/);
  assert.match(install, /keeping existing \$ENV_DIR\/designer\.env/);
  assert.match(install, /if \[ ! -f "\$ENV_DIR\/designer_secret" \]/);
  assert.match(install, /openssl rand -hex 32/);
  assert.match(install, /chmod 0640 "\$ENV_DIR\/designer_secret"/);
});

test('systemd unit keeps the setuid bubblewrap path available', async () => {
  const unit = await read('nextore-designer.service.in');
  for (const directive of [
    'NoNewPrivileges=no',
    'ProtectSystem=full',
    'ProtectHome=yes',
    'PrivateTmp=yes',
    'Restart=always',
  ]) {
    assert.ok(unit.includes(directive), directive);
  }
  // These install seccomp filters and implicitly enable NoNewPrivileges, which
  // disables the setuid bwrap helper Ubuntu ships.
  for (const directive of [
    'SystemCallFilter=',
    'RestrictNamespaces=',
    'RestrictAddressFamilies=',
    'RestrictSUIDSGID=',
    'LockPersonality=',
    'ProtectClock=',
  ]) {
    assert.ok(!unit.includes(directive), directive + ' would force NoNewPrivileges');
  }
  // strict (or the kernel protections it implies) locks the /proc mount that
  // bubblewrap must replace inside its namespace.
  for (const directive of [
    'ProtectSystem=strict',
    'ProtectKernelTunables=yes',
    'ProtectKernelModules=yes',
    'ProtectControlGroups=yes',
  ]) {
    assert.ok(!unit.includes(directive), directive + ' would lock the bwrap proc mount');
  }
  assert.ok(unit.includes('MemoryDenyWriteExecute=no'), 'V8 needs writable executable pages');
});

test('env example targets the edition and keeps the data root configurable', async () => {
  const env = await read('designer.env.example');
  assert.match(env, /^OD_EDITION=nextore$/m);
  assert.match(env, /^OD_SANDBOX=bwrap$/m);
  assert.match(env, /^OD_DATA_DIR=@DATA_DIR@$/m);
  assert.match(env, /^DESIGNER_SECRET_FILE=\/etc\/nextore-designer\/designer_secret$/m);
  assert.doesNotMatch(env, /^(NEXTORE_BASE_URL|NEXTORE_OAUTH_CLIENT_ID|DESIGNER_BASE_URL)=\S+/m);
});

test('tarball packaging includes the vendored assets and bundled content', async () => {
  const build = await read('build-tarball.sh');
  for (const entry of [
    'apps/daemon/vendor',
    'apps/web/out',
    'skills',
    'design-systems',
    'craft',
    'prompt-templates',
    'plugins/_official',
  ]) {
    assert.ok(build.includes(entry), entry);
  }
  assert.match(build, /sha256sum "\$OUT"/);
});

test('installer and image pin the same opencode version', async () => {
  const pinned = (await read('OPENCODE_VERSION')).trim();
  const dockerfile = await readFile(join(repoRoot, 'deploy/nextore/Dockerfile'), 'utf8');
  const imageVersion = /^ARG OPENCODE_VERSION=(\S+)$/m.exec(dockerfile)?.[1];
  assert.ok(imageVersion, 'Dockerfile must declare OPENCODE_VERSION');
  assert.equal(pinned, imageVersion);
});

test('installer installs the pinned opencode when it is missing', async () => {
  const install = await read('install.sh');
  assert.match(install, /opencode-ai@\$version/);
  assert.match(install, /command -v opencode/);
});
