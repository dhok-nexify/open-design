# Upstream sync

This repository is a downstream fork. Upstream moves quickly, and this fork carries
edition, branding, and integration work. The goal of this document is to keep the
cost of syncing predictable: **most conflicts should be machine-resolved, and the
remaining ones should be a short, known list**.

## The model

Every file a downstream change touches is either:

- **Fork-owned** — it lives in a directory the fork created and upstream does not
  maintain. These paths are listed in `scripts/upstream-sync.config.json`
  (`ownedPathGlobs`). They never conflict, because upstream never edits them.
- **Upstream-owned debt** — an upstream file the fork had to edit. Every one of
  these is a future conflict, so the fork tracks them as debt.

`pnpm sync:check` measures that debt and fails when it grows past the budgets in
the config. **Budgets only go down.** Raising one is a product decision that needs
an explicit review, not a convenience for getting a branch merged.

## Commands

```
pnpm sync:report                 # classify a real dry-run merge (no worktree changes)
pnpm sync:report --json          # same inventory, machine readable
pnpm sync:report --out .tmp/upstream-sync.md
pnpm sync:check                  # divergence budgets
pnpm sync:check --conflicts      # budgets plus merge-conflict counts (needs upstream/main)
```

`sync:report` runs `git merge-tree --write-tree --name-only --messages`, which
performs the same merge as `git merge` but writes nothing to the worktree. Pass
`--input` to replay a saved merge-tree output instead of running git.

Each conflict is classified and gets a default route:

| Category | Default action | Meaning |
| --- | --- | --- |
| `locale` | `scripted` | Apply the key-union overlay; never hand-merge translations |
| `test` | `take-upstream` | Take upstream, then adapt assertions to the downstream UI |
| `docs` | `take-upstream` | Take upstream unless the section is downstream-specific |
| `prompt-asset` | `review` | Read `docs/prompt-composition.md` before changing prompt text |
| `contract` | `review` | Keep additive types in dedicated modules |
| `source` | `review` | Preserve upstream logic, re-apply the downstream seam |
| `root` | `review` | Root manifests and marketing copy usually stay downstream |

## Sync runbook

1. **Tag the current branch** so the merge can be reverted as a unit.
2. `git fetch upstream main --no-tags` (fetching the whole fork graph is slow and
   unnecessary; keep the upstream fetch refspec limited to `main`).
3. `pnpm sync:report` — record the conflict inventory before touching anything.
4. Merge on a scratch branch, never on the shared integration branch:
   `git switch -c sync/upstream-<date>` then `git merge --no-ff --no-commit upstream/main`.
5. Resolve in this order: `scripted` → `take-upstream` → `review`. Keep
   "conflict resolution" and "adaptation fixes" as separate commits.
6. Run `pnpm guard`, `pnpm typecheck`, `pnpm i18n:check`, and the tests for the
   packages that changed. Then open a pull request into the integration branch.
7. Lower the budgets in `scripts/upstream-sync.config.json` when the sync paid
   down debt.

Enable `git rerere` and `merge.conflictStyle=zdiff3` locally; rerere replays
previous resolutions and zdiff3 makes "ours vs theirs" decisions obvious.

## What actually reduces manual work

Conflict counts are a symptom. The cure is moving downstream changes out of
upstream-owned files:

1. **Translations (done).** Upstream locale files are byte-identical to upstream;
   downstream keys and brand overrides live in `apps/web/src/i18n/nextore/` and
   are merged by `nextore/registry.ts`. Locale conflicts are gone from the sync
   inventory, and `apps/web/tests/i18n/nextore-overlay.test.ts` keeps every locale
   key-complete.
2. **Feature trimming.** Deleting an upstream file causes a modify/delete
   conflict on every later sync. Gate the surface behind the edition switch
   instead: the code stays, upstream tests keep passing, and no conflict is
   produced. Community is already handled this way.

   A few files are genuinely gone rather than gated (upstream tests for surfaces
   the edition does not ship). List them in `keepDeletedPaths` in
   `scripts/upstream-sync.config.json`. During a merge, `pnpm sync:resolve`
   deletes exactly those conflicted paths, so the decision is made once in
   configuration instead of once per sync.
3. **Brand strings.** Every user-visible product name goes through the brand
   placeholder. Upstream copy updates then inherit the downstream name for free.
4. **Wiring.** `apps/daemon/src/server.ts` and `apps/web/src/App.tsx` are the two
   hottest files. Collapse the downstream wiring into one mount point per side so
   a sync touches a handful of lines instead of dozens of hunks.
5. **Prompts.** Additive downstream instructions belong in a separate scenario or
   variant, not in the middle of upstream assets.

## Automation path

Once the seam is small, the sync can run unattended:

1. Scheduled job fetches upstream `main` and creates `sync/upstream-<date>`.
2. `pnpm sync:report` classifies the merge and applies the scripted routes.
3. `pnpm sync:check --conflicts` gates the result.
4. If only `review` conflicts remain, the job opens a pull request with the
   inventory attached; otherwise it opens an issue with the same report.

Do not automate this before the seam is reduced: automation over a large seam only
makes the churn faster.
