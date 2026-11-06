# NexTore Designer — installation and operations guide

NXD-D38. This guide covers the three supported deployment shapes, the settings
surface, backups, upgrades and the checks that tell you a deployment is healthy.
Artifact-level details live in [`deploy/nextore/README.md`](../../deploy/nextore/README.md).

## 1. What a deployment consists of

| Component | Role |
|---|---|
| NexTore (with `NexToreDesignerModule`) | Identity, ACL, workspaces/projects metadata, model routing, branding, audit. The only source of truth for who a user is and what they may open. |
| NexTore Designer daemon | Serves the web app and `/api/*`, stores project content, conversations, artifacts, memory and run records, and spawns the agent inside bubblewrap. |
| Agent runtime | A pinned `opencode` build, driven through the daemon's BYOK provider config. It never holds a NexTore credential. |

Nothing in the Designer talks to a model vendor directly: model calls go through
NexTore's Prompt API on behalf of the session's member.

## 2. Prerequisites

Common to every shape:

- A NexTore instance (Core 4.19 / net10 or later) with `OAuthServerModule` and
  `AIApplicationModule` installed, and `NexToreDesignerModule` deployed.
- An OAuth client registered for this Designer installation; its id becomes
  `NEXTORE_OAUTH_CLIENT_ID`, and `DESIGNER_BASE_URL` must match its redirect.
- A 32-byte session secret stored in a file outside the repository.
- Linux kernel with unprivileged user namespaces enabled (the agent sandbox needs
  them), and `bubblewrap` installed.

Check the sandbox prerequisite before anything else:

```bash
cat /proc/sys/kernel/unprivileged_userns_clone   # expect 1
bwrap --die-with-parent --unshare-pid --ro-bind / / --dev /dev --proc /proc --tmpfs /tmp /bin/true && echo ok
```

If that second command fails as the service user, check `aa-status` (AppArmor can
deny the namespace or the mounts) before going further. The daemon fails closed in
production: a run that cannot be sandboxed is refused rather than executed
unsandboxed.

## 3. Deployment shapes

### A. Linux host (tarball + systemd)

Best for a dedicated VM or a bare-metal host.

```bash
bash deploy/nextore/linux/build-tarball.sh
tar -xzf dist/nextore-designer-<version>-linux-<arch>.tar.gz -C /tmp/designer-payload
sudo /tmp/designer-payload/install/install.sh
sudoedit /etc/nextore-designer/designer.env     # fill in the NexTore values
sudo systemctl start nextore-designer
journalctl -u nextore-designer -f
```

`install.sh` creates the service user, the data directory, the env file and the
secret (all idempotent), verifies the sandbox as the service user, installs and
enables `nextore-designer.service`. Use `--prefix`, `--data-dir` and `--user` to
move the install root, the data root or the account; `--start` starts it
immediately.

### B. Docker / Podman compose

```bash
cp deploy/nextore/.env.example deploy/nextore/.env
# fill in NEXTORE_BASE_URL, NEXTORE_OAUTH_CLIENT_ID, DESIGNER_BASE_URL
openssl rand -hex 32 > deploy/nextore/designer_secret
docker compose -f deploy/nextore/compose.yml up -d
```

The compose file loads the shipped seccomp profile and disables the AppArmor
profile because Docker's default seccomp profile blocks the namespace calls
bubblewrap needs. The container runs as an unprivileged user with a read-only
root filesystem; only the data volume and `/tmp` are writable.

### C. Windows host with a Linux VM

Designer does not run natively on Windows for this edition: the sandbox and the
service model are Linux-only. The supported shape is a Linux VM (Hyper-V, WSL2
with systemd, or a small cloud VM) running shape A or B, with NexTore reachable
over the network.

- Put Designer on the same network path as NexTore; do not expose the daemon port
  beyond a reverse proxy.
- `DESIGNER_BASE_URL` must be the URL users actually type, including scheme and
  port, because it is the OAuth redirect origin.
- Keep the VM clock synchronised: session and token expiry are time-based.

## 4. Settings

### 4.1 Daemon environment

| Variable | Required | Purpose |
|---|---|---|
| `OD_EDITION` | yes | Must be `nextore`. Enables the edition gates; anything else runs upstream behavior. |
| `OD_DATA_DIR` | yes | The daemon data root. Every daemon-owned file derives from it. Point it at a dedicated volume/directory and back it up as a unit. |
| `OD_BIND_HOST` / `OD_PORT` | yes | Listen address and port (default `0.0.0.0:7456` in the image). |
| `NEXTORE_BASE_URL` | yes | NexTore origin, no path, no credentials. |
| `NEXTORE_OAUTH_CLIENT_ID` | yes | Client id pre-registered for this installation. |
| `DESIGNER_BASE_URL` | yes | Public origin of this Designer; must match the OAuth redirect. |
| `DESIGNER_SECRET_FILE` | yes | File holding the session secret. Rotating it invalidates existing sessions. |
| `OD_SANDBOX` | no | `bwrap` (default in the edition) or `noop` (development only, logged as a warning). |
| `OD_BWRAP_BIN` | no | Path to bubblewrap when it is not on `PATH`. |
| `TRUST_PROXY` | no | Set when a reverse proxy terminates TLS in front of Designer. |
| `OD_ALLOWED_ORIGINS` | no | Extra allowed origins for browser requests. |
| `OD_RESOURCE_ROOT` | no | Override for packaged resource lookup; leave unset for the shipped layouts. |

### 4.2 NexTore module settings

The module's settings page owns the deployment identity: site title, brand name,
logos, favicon, primary colour, loading text, the Fast/Expert model mapping and
`DesignerBaseUrl`. Branding reaches the shell and the prompt through the same
five-minute cache, so a rename takes effect without restarting the daemon.

## 5. Verifying a new deployment

1. `GET /api/health` returns ok and reports `edition: nextore`.
2. `GET /api/branding` returns the configured brand (200, with an ETag).
3. Signing in through NexTore returns to Designer and the sidebar shows a branded
   menu entry.
4. A member without `DesignerAccess` gets a permission error, not an empty list.
5. Create a project, generate one small artifact, open the preview: no request may
   leave the Designer origin (Network panel, "Offline" mode).
6. `journalctl -u nextore-designer` shows no `SANDBOX_UNAVAILABLE` and no
   `OD_SANDBOX=noop` warning.

## 6. Backup and restore

Back up these two things together:

- **The daemon data root** (`OD_DATA_DIR`). It contains the SQLite database, project
  content, artifacts, memory and MCP configuration. Copy it while the service is
  stopped, or take a filesystem snapshot that is consistent across the files.
- **The session secret file.** Without it every session is invalid after a restore
  and every user must sign in again.

NexTore keeps the authoritative workspace/project records, ACLs and model routing;
the Designer data root holds the content those records point at. Restoring only one
side leaves projects that exist but have no content, or content nobody can reach —
restore both or neither.

Restore procedure: stop the service, put the data root back at the same path with
the same owner, restore the secret file, start the service, then re-run the checks
in section 5. Do not copy a data root between different `DESIGNER_BASE_URL`
hostnames without re-checking sessions.

## 7. Upgrade and rollback

Before shipping a build, run the two pre-flight checks: `pnpm --filter @open-design/daemon verify:vendor` (every vendored asset matches its pinned size and sha256) and `pnpm guard`. A failed vendor check ships as a broken preview, not as a build error, so it is worth the ten seconds.

1. Keep the previous tarball/image tag and a fresh backup.
2. Stop the service, install the new version over the old one, start it.
3. The daemon migrates its database on boot; a failed migration leaves the
   service down rather than serving a half-migrated database.
4. Roll back by reinstalling the previous artifact and restoring its backup. Keep
   the secret file unchanged across upgrades unless you intend to sign everyone
   out.

## 8. Troubleshooting

| Symptom | Likely cause |
|---|---|
| `SANDBOX_UNAVAILABLE` in the log | bubblewrap missing, unprivileged user namespaces disabled, or AppArmor denying mounts. Run the probe from section 2 as the service user. |
| `OD_EDITION` ignored / upstream UI | The variable is not exported to the daemon process, or contains a typo. |
| 401 on every API call | Session secret changed, clock skew, or the OAuth redirect origin does not match `DESIGNER_BASE_URL`. |
| `model_not_found` from a generation | The Fast/Expert model mapping in the module settings points at a model the caller cannot read. |
| Preview renders unstyled | `/vendor/*` answered 503: the vendored asset tree is missing from the install, or its bytes no longer match `VENDOR_ASSETS`. Run `pnpm --filter @open-design/daemon verify:vendor` — it names the offending file. A size that is a few hundred bytes too large on a Windows checkout means line endings were converted; re-checkout `apps/daemon/vendor` (the committed `.gitattributes` marks it as binary) and rerun the check. |
| Branding not updating | The five-minute cache; wait for the TTL or restart the daemon. |
