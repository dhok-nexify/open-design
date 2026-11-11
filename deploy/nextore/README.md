# NexTore Designer — container deployment

NXD-D35 artifact set: an OCI image plus a single-host compose example. For the
systemd/Linux-host path see NXD-D36; for the operator guide (settings table,
backup, reverse proxy) see NXD-D38.

## Files

| File | Purpose |
|---|---|
| `Dockerfile` | Multi-stage image: pnpm build of daemon + web, pinned `opencode-ai`, bubblewrap, non-root user. |
| `compose.yml` | One Designer service with the seccomp profile bwrap needs, a data volume and a secret file. |
| `seccomp-bwrap.json` | Denied-syscall example profile. See "Sandbox requirements" below. |
| `.env.example` | The deployment values the compose file requires. |
| `linux/` | NXD-D36 tarball build, `install.sh`, systemd unit and the service env example. |

## Build and run

```bash
cp deploy/nextore/.env.example deploy/nextore/.env
# fill in NEXTORE_BASE_URL, NEXTORE_OAUTH_CLIENT_ID, DESIGNER_BASE_URL
openssl rand -hex 32 > deploy/nextore/designer_secret

docker compose -f deploy/nextore/compose.yml build
docker compose -f deploy/nextore/compose.yml up -d
```

The container runs as `designer` (uid 10001) with a read-only root filesystem.
The only writable locations are the data volume and `/tmp`.

## Sandbox requirements

Every edition run is executed inside bubblewrap (`OD_SANDBOX=bwrap`). That needs
two host-level allowances:

1. **User namespaces.** `/proc/sys/kernel/unprivileged_userns_clone` must be 1
   (Debian/Ubuntu default) or the container must run with the capability to
   create them. Verify on the host:

   ```bash
   sysctl kernel.unprivileged_userns_clone
   ```

2. **Seccomp + AppArmor.** Docker's default seccomp profile blocks
   `unshare`/`mount` combinations bwrap relies on, so `compose.yml` loads
   `seccomp-bwrap.json` and disables the AppArmor profile. Confirm the sandbox
   works before putting Designer behind a proxy:

   ```bash
   docker compose -f deploy/nextore/compose.yml run --rm --entrypoint /usr/bin/bwrap designer \
     --die-with-parent --unshare-pid --ro-bind / / --dev /dev --proc /proc --tmpfs /tmp /bin/true
   ```

`seccomp-bwrap.json` is a **deny-list example**, not a reviewed allow-list: it
blocks the kernel-loading and debug syscalls (module loading, kexec, bpf, ptrace,
perf, handle-based open) while leaving the namespace and mount calls bwrap needs.
Treat it as a starting point for the platform team's own profile.

If the probe fails the daemon refuses to start agent runs (`SANDBOX_UNAVAILABLE`)
in production. `OD_SANDBOX=noop` disables isolation and is meant for development
hosts only; the daemon logs a warning at boot.

## Linux host install

```bash
bash deploy/nextore/linux/build-tarball.sh      # dist/nextore-designer-<version>-linux-<arch>.tar.gz
tar -xzf dist/nextore-designer-*.tar.gz -C /tmp/designer-payload
sudo /tmp/designer-payload/install/install.sh --start
```

The installer checks the user-namespace sysctls, probes bubblewrap as the
service user with and without `NoNewPrivileges`, then probes it again through
`systemd-run` with the unit's mount protections. It creates the data directory
and secret, installs `nextore-designer.service` and enables it. It is
idempotent: an existing
`/etc/nextore-designer/designer.env` and secret are kept. The systemd unit
deliberately omits seccomp-based hardening (`SystemCallFilter`,
`RestrictNamespaces`, `RestrictAddressFamilies`, `RestrictSUIDSGID`,
`LockPersonality`, `ProtectClock`) because those directives implicitly enable
`NoNewPrivileges`, which disables the setuid bubblewrap helper Ubuntu ships.

## Data and secrets

- Everything the daemon owns (SQLite, artifacts, memory, MCP config, run scratch)
  derives from `OD_DATA_DIR`, which points at the `designer_data` volume.
  Do not bind-mount application subdirectories individually.
- The session secret is mounted as `/run/secrets/designer_secret`; rotating it
  invalidates existing sessions by design.
- No credential is baked into an image layer.

## Health

`GET /api/health` on the container port. The compose healthcheck polls it every
30 s after a 30 s start period.
