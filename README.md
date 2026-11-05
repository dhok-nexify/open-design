<h1 align="center">NexTore Designer</h1>

<p align="center">
  An agent-driven design and prototyping workspace for NexTore: describe the deliverable, watch it
  being built, and keep every artifact inside your own network.
</p>

<p align="center">
  <a href="docs/nextore/INSTALL.md">Install</a> ·
  <a href="deploy/nextore/README.md">Deployment artifacts</a> ·
  <a href="PRIVACY.md">Privacy</a> ·
  <a href="NOTICE">Notice</a> ·
  <a href="LICENSE">License</a>
</p>

---

> **This repository is the NexTore edition of [OpenDesign](https://github.com/nexu-io/open-design).**
> It is a soft fork: the upstream engine is kept intact and every NexTore behavior sits behind
> `OD_EDITION=nextore`. With `OD_EDITION` unset the build behaves exactly like upstream, which is
> what keeps upstream merges possible. See [NOTICE](NOTICE) for the attribution.

## What it is

NexTore Designer turns a coding agent into a design studio. A member describes what they need —
a slide deck, a prototype, a dashboard, a document — and the agent plans, writes and revises real
HTML/CSS artifacts in a project directory. The result is previewed in the app, can be inspected and
commented on, and exports as HTML, PDF or PPTX.

Identity, permissions, workspaces, project metadata, model routing and audit belong to NexTore.
Designer keeps the content those records point at, plus conversations, comments, share grants and
run history.

## What the edition changes

| Area | Behavior with `OD_EDITION=nextore` |
|---|---|
| Identity | NexTore OAuth. No local account, no API-token gate. |
| Execution | One runtime: the daemon-owned BYOK OpenCode path. Agent processes run inside bubblewrap; a host that cannot sandbox fails closed in production. |
| Models | Fast/Expert tiers resolved by NexTore. The agent never holds a NexTore credential; calls go through the daemon's run-scoped proxy. |
| Network | No telemetry, no cloud accounts, no marketplace, no community or connector calls. Bundled fonts, scripts and styles are served from `/vendor`; the catalogue contains no external asset host. |
| Product surfaces | Onboarding, updater, campaigns, surveys, What's New, image/video generation, Figma, design browser, Automations, HyperFrames, terminals and host tools are off. |
| Branding | Site title, brand name, logos, favicon, primary color and loading text come from the NexTore module and are cached for five minutes. |
| Localization | 19 locales; the product name is a single `{brandName}` placeholder, defaulting to NexTore Designer. |

## Install

- **Linux host** — tarball + `install.sh` + systemd unit: [docs/nextore/INSTALL.md §3A](docs/nextore/INSTALL.md).
- **Docker / Podman** — compose example with the seccomp profile bubblewrap needs:
  [deploy/nextore/README.md](deploy/nextore/README.md).
- **Windows host** — run the Linux shapes inside a VM; Designer's sandbox and service model are
  Linux-only: [docs/nextore/INSTALL.md §3C](docs/nextore/INSTALL.md).

Prerequisites: Node 24, bubblewrap, and a NexTore instance with `NexToreDesignerModule`,
`OAuthServerModule` and `AIApplicationModule`. The full settings table, verification checklist,
backup/restore and troubleshooting live in [docs/nextore/INSTALL.md](docs/nextore/INSTALL.md).

## Configuration

Everything is environment-driven and documented in the install guide. The values a deployment
cannot run without are `OD_EDITION`, `OD_DATA_DIR`, `NEXTORE_BASE_URL`,
`NEXTORE_OAUTH_CLIENT_ID`, `DESIGNER_BASE_URL` and `DESIGNER_SECRET_FILE`.

Brand name, logos, colours, the Fast/Expert model mapping and `DesignerBaseUrl` are runtime
settings on the NexTore module, not build-time constants.

## Data, privacy and security

- All daemon-owned state lives under one data root (`OD_DATA_DIR`); back it up with the session
  secret as a unit. No user data is baked into an image or a tarball.
- The edition sends no product telemetry and makes no third-party asset requests. See
  [PRIVACY.md](PRIVACY.md).
- The agent runs inside bubblewrap with a read-only host filesystem, a writable project directory,
  a throwaway HOME, and an environment scrubbed of daemon paths, tokens, secrets and passwords.
- Model credentials stay in the daemon session store; the sandbox only ever receives a run-scoped
  token for the daemon's own proxy.

## Development

```bash
corepack enable && pnpm install     # Node 24, pnpm 10.33.2
pnpm tools-dev                      # local development lifecycle
pnpm guard                          # repository invariants
pnpm typecheck                      # workspace typecheck
pnpm --filter @open-design/daemon test
pnpm --filter @open-design/web test
```

`apps/web` is the Next.js App Router UI, `apps/daemon` owns `/api/*`, agent spawning, skills and
artifacts, and `packages/contracts` carries the shared DTOs. [AGENTS.md](AGENTS.md) is the
authoritative guide to the repository layout, commands and conventions;
[CONTRIBUTING.md](CONTRIBUTING.md) covers the contribution flow.

Edition-specific CI runs from [.github/workflows/nextore-ci.yml](.github/workflows/nextore-ci.yml).

## Repository layout

| Path | Contents |
|---|---|
| `apps/daemon` | Local privileged daemon, `od` CLI, API routes, agent runtimes, sandbox |
| `apps/web` | Web UI |
| `packages/contracts` | Shared TypeScript contracts (web/daemon/API) |
| `skills/`, `design-templates/`, `design-systems/`, `craft/` | Content the agent reads and renders |
| `deploy/nextore/` | Container image, compose example, Linux installer |
| `docs/nextore/` | NexTore edition documentation |

## License and attribution

Apache License 2.0 — see [LICENSE](LICENSE). This distribution is based on OpenDesign; the required
attribution and the licenses of the bundled third-party components are in [NOTICE](NOTICE).

Upstream project documentation remains in this repository under its original terms:
[OpenDesign](https://github.com/nexu-io/open-design).
