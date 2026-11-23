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

History: the budget moved 488 -> 496 -> 505 -> 522 -> 557 -> 561 -> 572.
The 496 entry was measured against the pre-commit tree, so it understated
committed divergence. 505 was the committed count at `05d75ad6be`; six later
NexTore UI fixes touched 17 additional upstream-owned files, so 522 was the
count at `5d5c925c88`. Four further NexTore commits touched 35 more files, so
the 2026-11-19 checkpoint `42f6745cc9` measured 557; the Windows adaptations
for that merge added 4 files, giving 561. Local NexTore work between the two
syncs (export and snapshot rendering, layout reservations, polling) touched 11
more upstream-owned files, so the 2026-11-23 checkpoint `c079f7d790` measured
572. The two upstream commits merged on 2026-11-23 added no fork divergence;
the guard fix for the snapshot renderer is fork-owned.
Payback: upstream the path-separator, stylesheet-segment, `previous.log`,
POSIX-shell-guard, and HTML-boundary fixes, then drop the entries and lower
the budget again. Every later commit must re-run `pnpm sync:check`; do not
carry a stale budget into the next sync.

### 2026-11-17 snapshot

| Item | Value |
| --- | --- |
| Checkpoint tag | `pre-upstream-sync-20261116` (`681e47a9f2`) |
| Merge commit | `559bcc3c33` |
| Upstream tip merged | `84dd08b570` |
| Divergence budget | 522 upstream-owned files |
| Merge conflicts | 71 |
| Modify/delete conflicts | 3 |

Later upstream tips do not change this snapshot; re-run `pnpm sync:report` for
the next sync.

### 2026-11-19 snapshot

| Item | Value |
| --- | --- |
| Checkpoint tag | `pre-upstream-sync-20261119` (`42f6745cc9`) |
| Merge commit | `c920e729c8` |
| Upstream tip merged | `07258801b9` |
| Divergence budget | 561 upstream-owned files |
| Merge conflicts | 1 (content 1) |
| Modify/delete conflicts | 0 |

The only conflict was `README.md`: upstream added an OpenDesign product tour,
while the fork keeps the NexTore edition README. Root marketing copy stays
downstream.

### 2026-11-23 snapshot

| Item | Value |
| --- | --- |
| Checkpoint tag | `pre-upstream-sync-20261123` (`c079f7d790`) |
| Merge commit | `4ef4e06df0` |
| Upstream tip merged | `e033aad1d1` |
| Divergence budget | 572 upstream-owned files |
| Merge conflicts | 0 |
| Modify/delete conflicts | 0 |

The upstream delta was two commits: dynamic Vela video-duration validation and
removal of the external-link icon from the sign-in reopen link. No manual merge
resolution was needed. The only integration fix was a pre-existing guard
failure in the fork-owned snapshot renderer.

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

It still writes temporary tree objects under `.git/objects`, so a restricted
sandbox that mounts `.git` read-only must run it with repository write access.
Otherwise git fails with `insufficient permission for adding an object`.

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
6. Run the post-merge verification ladder below. Do not open the pull request
   until every rung passes or the exception is written down in the PR.
7. Commit the resolution and adaptation work first, then measure with
   `pnpm sync:check --conflicts`. The check compares `upstream/main...HEAD`, so a
   dirty worktree is invisible to it. Lower the budgets in
   `scripts/upstream-sync.config.json` when the sync paid down debt; raise one
   only with a written payback plan.

Enable `git rerere` and `merge.conflictStyle=zdiff3` locally; rerere replays
previous resolutions and zdiff3 makes "ours vs theirs" decisions obvious.

### Restarting safely

Once a resolution decision has been made, do not run `git merge --abort`: it
throws away every resolved path and the rerere cache you just trained. If the
merge must be restarted, reset the scratch branch to the checkpoint tag
(`git reset --hard pre-upstream-sync-<date>`) and re-run `pnpm sync:report`.

## Post-merge verification ladder

Run the rungs in order. Each one is cheap; skipping a lower rung is what turns a
mechanical merge into a week of follow-up fixes.

1. **Merge hygiene.** `git status --short`, `git diff --check`, and
   `rg -n "^<<<<<<< |^>>>>>>> " --glob "!**/node_modules/**" .` must be clean.
   Confirm `MERGE_HEAD` is gone after the merge commit.
2. **Static gates.** `pnpm guard`, `pnpm typecheck`, `pnpm i18n:check`.
3. **Focused tests.** Run the suites for the packages that changed, not the full
   local matrix, and name them in the PR. On Windows, daemon lifecycle suites
   need `--hookTimeout 30000`; large jsdom suites may need `--maxWorkers=6`.
4. **Product-surface walkthrough.** Open the edition surfaces a user reaches
   from the project page and the artifact viewer. A passing suite does not prove
   that an entry point is mounted.
5. **Orphan wiring scan.** Search for state setters and handlers that survived
   the merge without a call site:
   `rg -n "setShareDialogOpen|openNextorePermissions|projectQuarantined" apps/web/src`.
   A definition with no caller is a lost feature, not dead code.
6. **Chrome diff.** Compare the changed header and workspace blocks against the
   checkpoint tag (`git diff <checkpoint>..HEAD -- <files>`). Upstream rewrites
   chrome blocks wholesale; handlers can survive while their trigger disappears.
7. **Edition boundaries.** Inventory new upstream route prefixes and add every
   user-facing surface to `apps/daemon/src/edition/route-kill-switch.ts`. Gate
   cloud-only UI with `isFeatureEnabled("collab-cloud")` instead of deleting it.
8. **Brand and locale.** Upstream locale files stay byte-identical; downstream
   strings live under `apps/web/src/i18n/nextore/`. Confirm there is no new
   hardcoded upstream product name in source or tests; use `getBrandName()`.
9. **Debt.** Commit first, then run `pnpm sync:check --conflicts`, and record the
   measured budget plus its payback plan in this file.

## Merge-review checklist

Copy this into the sync PR and tick every line:

- [ ] Checkpoint tag exists and the merge ran on a scratch branch.
- [ ] `git diff --check` is clean and no conflict markers remain.
- [ ] `pnpm guard`, `pnpm typecheck`, and `pnpm i18n:check` pass.
- [ ] Focused suites for every touched package pass, or the failure is a
      recorded Windows-only timeout reproduced by a single-file run.
- [ ] Every new upstream `/api/*` prefix is covered by the edition kill switch.
- [ ] Every cloud-only surface is behind `isFeatureEnabled("collab-cloud")`.
- [ ] Project-level entries (share link, permissions, quarantine) have a live
      mount point and a regression test.
- [ ] Upstream locale files are unchanged:
      `git diff --stat upstream/main...HEAD -- apps/web/src/i18n/locales` is empty.
- [ ] Brand-copy tests use the production mask or `getBrandName()`.
- [ ] Resolution and adaptation are separate commits.
- [ ] The worktree is committed before `pnpm sync:check --conflicts`.
- [ ] Any budget change has a payback plan in this file.

## Pitfalls from the 2026-11-16 sync

| Pitfall | Symptom | Root cause and durable fix | Guard |
| --- | --- | --- | --- |
| CRLF ghost changes | `git status` listed about 10,000 modified files while `git diff` was empty, and exact-text tests failed. | A Windows checkout had CRLF line endings plus stale index stat data. `.gitattributes` now pins `* text=auto eol=lf`; tracked text was normalised to LF and the index refreshed once. | Confirm `git diff` is empty before `git add -A`; never commit or discard the ghost set. |
| Exact-source tests on Windows | Style and copy suites failed on source text that looked correct. | The tests compare raw text, so CRLF is a real difference. The LF policy plus per-imported-file stylesheet injection in jsdom removed the false failures. | Reproduce one failing file with a verbose reporter before assuming a logic regression. |
| Locale conflicts | Every sync reopened translation files. | Downstream keys lived in upstream locale files. Upstream locale files are now byte-identical and downstream strings live under `apps/web/src/i18n/nextore/`, merged by `nextore/registry.ts`. | Keep the locale diff empty and the overlay key-completeness test green. |
| Brand-mask gaps | New upstream product names leaked through the white-label surface. | The mask was a curated key list, so new keys escaped it. `merge.ts` now masks every locale value and preserves handles such as `@OpenDesignHQ`. | Brand-references tests plus `getBrandName()` in assertions. |
| Brand-copy tests | Verbatim "OpenDesign" assertions failed no matter how the source was shaped. | The assertion itself is the brand. Those copy-only files are declared in `ownedPathGlobs`; behaviour tests stay upstream-owned and are adapted in place. | Own only copy assertions, never behaviour tests. |
| Lost project entries | The share dialog setter, permission handler, and quarantine flag survived with no caller or render site. | Upstream rewrote the project header and removed the mount points while keeping the handlers. `apps/web/src/nextore/project-actions.tsx` now mounts through `FileWorkspace.headerActions`, and the quarantine notice renders in the workspace status row. | Orphan-wiring scan plus a chrome diff against the checkpoint tag. |
| Cloud Share tab | The artifact viewer offered upstream cloud sharing while `/api/collab` is disabled. | The tab was not edition-gated. `artifactCloudShareAvailable = isFeatureEnabled("collab-cloud")` now hides it; project sharing uses NexTore links. | Audit every share and collab surface for the feature flag. |
| Kill-switch omission | New `/api/touchpoints/*` routes were reachable in the edition. | Upstream added a route family after the kill-switch table was written. It now shares the `campaigns` rule. | Diff the new route prefixes against `route-kill-switch.ts` on every sync. |
| jsdom parse timeouts | Large style suites timed out on Windows. | One giant expanded `<style>` element exceeded the test timeout. Styles are injected one element per imported CSS file, with higher timeouts and a Windows worker cap. | Keep style fixtures per file; do not bundle them into one blob. |
| Stale product-contract test | `chips.removed-types.test.ts` asserted a Home-only catalogue that no longer exists. | The test described removed implementation history. It was replaced by `chips.create-rail.test.ts`, which covers the shared catalogue and edition hiding. | Test the current ownership model, not deleted code. |
| Intentional focus divergence | An upstream test expected no directory read when the window regained focus. | The fork deliberately refreshes the team directory. The upstream test was adapted with a recorded divergence note. | Record every intentional divergence in the test and in this document. |
| Pre-commit measurement | `sync:check` reported 496 before the commit and 505 after it. | The check measures `upstream/main...HEAD`, so uncommitted work is invisible. | Run `sync:check` only on a clean tree, after committing. |
| Stale planning ledger | `IMPLEMENTATION_STATUS.md` outside this repository still named old branches and pending tasks. | The ledger was not updated with the sync state. | Link the ledger update from the sync PR. |
| Read-only `.git` | `sync:report` or `sync:check --conflicts` failed with "insufficient permission for adding an object to repository database". | `git merge-tree --write-tree` writes temporary tree objects. | Run the command with repository write access; this is not a merge conflict. |
| Merge abort after resolution | A restart discarded resolved paths and rerere training. | `git merge --abort` is not a checkpoint. | Never abort a partially resolved merge; reset to the checkpoint tag instead. |

### Added on 2026-11-19

| Pitfall | Symptom | Root cause and durable fix | Guard |
| --- | --- | --- | --- |
| Windows `.sh` spawn | `skills.test.ts` failed with ENOENT on `playwright.log`. | `spawnSync` cannot execute a POSIX shell script on Windows (`EFTYPE`). The source assertions still run; the runtime assertions return early on win32 and stay covered on POSIX CI. | Guard bash-dependent tests with `process.platform`. |
| Server startup timeout | `plugins-live-previews.test.ts` timed out at 20 seconds. | Starting the full daemon takes about 43 seconds on Windows. | Give full-server tests a 90-second per-test timeout. |
| Packaged log path | The diagnostics test expected native separators but received a mixed path. | The resolver appended `/previous.log` with a literal slash. | Use `path.join(dirname(latest), "previous.log")`. |
| Stale budget at checkpoint | `sync:check` measured 557 while the document still said 522. | Four NexTore commits after the last measurement touched 35 upstream-owned files. | Re-measure at the checkpoint before merging, not only after. |
| README product tour | Upstream added a large OpenDesign tour and the merge conflicted. | Root marketing copy belongs to the downstream edition. | Keep the fork README and record the decision in the sync PR. |

### Added on 2026-11-23

| Pitfall | Symptom | Root cause and durable fix | Guard |
| --- | --- | --- | --- |
| HTML boundary guard | `pnpm guard` failed on `snapshot-renderer.ts` for a text `</head>` replace. | Fork code matched a structural tag by text; an author script string can contain it too. The renderer now uses `findRealTagOffset` with `HTML_TAG_PATTERNS.headClose`, and a regression test pins a `</head>` inside a script. | Use `findRealTagOffset` / `findRealTagEnd` for every structural HTML boundary. |
| Budget drift between syncs | The document said 561 while the checkpoint measured 572. | Local export, snapshot, layout, and polling work touched 11 upstream-owned files between syncs. | Re-measure at the checkpoint before merging, not only after. |

## Windows and line endings

The suite asserts exact source text, so the checkout must be LF on every
platform. `.gitattributes` carries `* text=auto eol=lf`, and Windows is easier
to reason about with `git config core.autocrlf false` in this repository.

After a merge or a line-ending normalisation, `git status` can show thousands of
modified files whose `git diff` is empty. That is stale index stat data, not
content. Confirm `git diff` is empty, then refresh the index once with
`git add -A`; never commit the ghost set and never "fix" it with
`git checkout -- .`, which would discard real edits.

Daemon lifecycle suites can exceed the default 10-second hook while loading the
full server graph on Windows; run them with `--hookTimeout 30000`. Large jsdom
suites may need `--maxWorkers=6`.

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

6. **Brand-copy contract tests (owned).** Upstream tests that assert the product
   name *verbatim* ("Welcome to OpenDesign", "Reinstall OpenDesign …") cannot pass
   in a white-label fork no matter how the source is shaped, because the assertion
   itself is the brand. Those files are listed in `ownedPathGlobs` so a sync keeps
   the fork's brand-aware expectation instead of reopening the same edit every
   time; the merge report shows them as owned rather than as new debt. Only
   copy-assertion tests belong there — behaviour tests stay upstream-owned and are
   adapted in place when the conformance work changes.

7. **HTML boundaries.** Never text-match `<head>`, `</body>`, `<base>`, or
   `<title>`. Use `findRealTagOffset` / `findRealTagEnd` from
   `packages/contracts/src/runtime/html-injection-points.ts`; the guard rejects
   text matches because author script strings can contain those tags.

## Automation path

Once the seam is small, the sync can run unattended:

1. Scheduled job fetches upstream `main` and creates `sync/upstream-<date>`.
2. `pnpm sync:report` classifies the merge; `pnpm sync:resolve` applies the
   configured kept-deleted paths; the remaining scripted routes follow.
3. `pnpm sync:check --conflicts` gates the result.
4. If only `review` conflicts remain, the job opens a pull request with the
   inventory attached; otherwise it opens an issue with the same report.

Do not automate this before the seam is reduced: automation over a large seam only
makes the churn faster.

## Remaining seam (measured 2026-11-16)

Two upstream-owned host files still carry most of the downstream wiring. The
numbers below are measured against the current merge base, not estimates:

| File | Downstream hunks | Added lines | Shape |
| --- | ---: | ---: | --- |
| `apps/daemon/src/server.ts` | 55 | 256 | spread through the ~15k-line `startServer` (imports, auth, ACL, routes, health, shutdown); the auth/middleware block already moved to `nextore/host-access.ts` |
| `apps/web/src/App.tsx` | 24 | 89 | imports plus state and hooks scattered through `AppInner`; branding bootstrap and the access gate already moved to `nextore/use-branding.ts` and `nextore/use-designer-access.ts` |

These are not one contiguous block, so collapsing them is a real refactor, not a
move. The target shape is one mount point per side:

```
daemon:  createNextoreHost(deps).mount(app)   // one call in startServer
web:     <NextoreWebLayer>{children}</NextoreWebLayer>   // one wrapper in App
```

Do that work against a clean checkpoint, with the daemon and web suites green
before and after; it is the only part of this plan with rollback risk.

The first slice is done: authentication, the DesignerAccess gate, and the route
kill switch mount through `mountNextoreAccess()` in
`apps/daemon/src/nextore/host-access.ts`; the edition API routes register through
`registerNextoreApiRoutes()` in the same module; project authorization composes
through `createProjectAuthorizer()` in `nextore/acl/authorizer-host.ts`, and
per-run MCP selection through `resolveRunMcpServers()` in
`nextore/mcp/run-servers.ts`; the health sandbox probe lives in
`nextore/health-sandbox.ts`, and the frame guard mounts through
`mountFrameDenyMiddleware()`.
Covered by the daemon auth, API-token, nextore-startup, and project-lifecycle
suites.
