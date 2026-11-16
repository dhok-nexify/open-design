// Upstream sync inventory CLI.
//
// `report` classifies a real dry-run merge without touching the worktree.
// `check` enforces divergence budgets so the fork cannot quietly grow more
// entangled with upstream-owned files.
//
// Usage:
//   pnpm sync:report [--upstream <ref>] [--input <merge-tree-output>] [--out <file>] [--json]
//   pnpm sync:check  [--upstream <ref>] [--conflicts] [--json]

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  evaluateBudgets,
  parseMergeTreeOutput,
  renderInventoryReport,
  selectKeepDeletedResolutions,
  summarizeConflicts,
  summarizeDivergence,
  type DivergenceSummary,
  type SyncConfig,
} from "./lib/upstream-sync.ts";

const repoRoot = path.resolve(import.meta.dirname, "..");
const configPath = path.join(repoRoot, "scripts", "upstream-sync.config.json");

type Command = "report" | "check" | "resolve" | "help";

type CliOptions = {
  command: Command;
  upstream: string | null;
  input: string | null;
  out: string | null;
  json: boolean;
  withConflicts: boolean;
};

type GitResult = { status: number; stdout: string; stderr: string };

function parseArgs(argv: readonly string[]): CliOptions {
  const command = (argv[0] ?? "help") as Command;
  const options: CliOptions = {
    command,
    upstream: null,
    input: null,
    out: null,
    json: false,
    withConflicts: false,
  };

  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index] ?? "";
    const next = argv[index + 1] ?? null;
    if (argument === "--json") {
      options.json = true;
    } else if (argument === "--conflicts") {
      options.withConflicts = true;
    } else if (argument === "--upstream" && next !== null) {
      options.upstream = next;
      index += 1;
    } else if (argument === "--input" && next !== null) {
      options.input = next;
      index += 1;
    } else if (argument === "--out" && next !== null) {
      options.out = next;
      index += 1;
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }

  return options;
}

function git(args: readonly string[]): GitResult {
  try {
    const stdout = execFileSync("git", [...args], {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 128 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string | Buffer; stderr?: string | Buffer };
    return {
      status: failure.status ?? 1,
      stdout: String(failure.stdout ?? ""),
      stderr: String(failure.stderr ?? ""),
    };
  }
}

async function loadConfig(): Promise<SyncConfig> {
  const raw = JSON.parse(await readFile(configPath, "utf8")) as Partial<SyncConfig>;
  if (
    typeof raw.upstreamRef !== "string" ||
    !Array.isArray(raw.ownedPathGlobs) ||
    raw.budgets === undefined ||
    typeof raw.budgets.upstreamOwnedFiles !== "number" ||
    typeof raw.budgets.mergeConflicts !== "number" ||
    typeof raw.budgets.modifyDeleteConflicts !== "number"
  ) {
    throw new Error(`invalid sync config at ${configPath}`);
  }
  return {
    ...(raw as SyncConfig),
    keepDeletedPaths: Array.isArray(raw.keepDeletedPaths) ? raw.keepDeletedPaths : [],
  };
}

function resolveUpstreamCommit(upstreamRef: string): string | null {
  const result = git(["rev-parse", "--short", upstreamRef]);
  return result.status === 0 ? result.stdout.trim() : null;
}

function collectDivergence(config: SyncConfig, upstreamRef: string): DivergenceSummary {
  const mergeBase = git(["merge-base", "HEAD", upstreamRef]);
  if (mergeBase.status !== 0) {
    throw new Error(
      `cannot resolve merge base with ${upstreamRef}; run 'git fetch upstream main' first (${mergeBase.stderr.trim()})`,
    );
  }

  const diff = git(["diff", "--name-only", "-M", `${upstreamRef}...HEAD`]);
  if (diff.status !== 0) {
    throw new Error(`git diff failed: ${diff.stderr.trim()}`);
  }

  const changedFiles = diff.stdout.split(/\r?\n/).filter((line) => line.trim() !== "");
  return summarizeDivergence({ changedFiles, ownedPathGlobs: config.ownedPathGlobs });
}

async function loadMergeInventory(input: string | null, upstreamRef: string) {
  if (input !== null) {
    return parseMergeTreeOutput(await readFile(path.resolve(repoRoot, input), "utf8"));
  }

  // merge-tree exits 1 when the merge has conflicts but still prints the full
  // inventory; anything above 1 means git could not run the merge at all.
  const result = git(["merge-tree", "--write-tree", "--name-only", "--messages", "HEAD", upstreamRef]);
  if (result.status > 1) {
    throw new Error(`git merge-tree failed: ${result.stderr.trim()}`);
  }
  return parseMergeTreeOutput(result.stdout);
}

function printSummary(divergence: DivergenceSummary, conflicts: ReturnType<typeof summarizeConflicts> | null): void {
  console.log(
    `divergent files: ${divergence.changed} (fork-owned ${divergence.owned}, upstream-owned ${divergence.upstreamOwned})`,
  );
  if (conflicts !== null) {
    console.log(
      `merge conflicts: ${conflicts.total} (content ${conflicts.byKind.content}, modify/delete ${conflicts.byKind["modify-delete"]}, scripted ${conflicts.byAction.scripted})`,
    );
  }
  if (divergence.upstreamOwnedByArea.length > 0) {
    const top = divergence.upstreamOwnedByArea.slice(0, 5)
      .map((entry) => `${entry.area}=${entry.count}`)
      .join(", ");
    console.log(`upstream-owned areas: ${top}`);
  }
}

async function runReport(options: CliOptions): Promise<void> {
  const config = await loadConfig();
  const upstreamRef = options.upstream ?? config.upstreamRef;
  const inventory = await loadMergeInventory(options.input, upstreamRef);
  const conflicts = summarizeConflicts(inventory.conflicts, {
    keepDeletedPaths: config.keepDeletedPaths,
  });
  const divergence = collectDivergence(config, upstreamRef);

  const markdown = renderInventoryReport({
    upstreamRef,
    upstreamCommit: resolveUpstreamCommit(upstreamRef),
    capturedAt: new Date().toISOString().slice(0, 10),
    conflicts,
    divergence,
  });

  if (options.out !== null) {
    const outPath = path.resolve(repoRoot, options.out);
    await mkdir(path.dirname(outPath), { recursive: true });
    await writeFile(outPath, markdown, "utf8");
    console.log(`wrote ${options.out}`);
  }

  if (options.json) {
    console.log(JSON.stringify({ conflicts, divergence }, null, 2));
  } else if (options.out === null) {
    console.log(markdown);
  }

  if (conflicts.byAction.review > 0) {
    console.log(`${conflicts.byAction.review} conflict(s) need a human decision; ${conflicts.byAction.scripted} can be scripted.`);
  }
}

async function runCheck(options: CliOptions): Promise<void> {
  const config = await loadConfig();
  const upstreamRef = options.upstream ?? config.upstreamRef;
  const divergence = collectDivergence(config, upstreamRef);
  const conflicts = options.withConflicts
    ? summarizeConflicts((await loadMergeInventory(null, upstreamRef)).conflicts, {
        keepDeletedPaths: config.keepDeletedPaths,
      })
    : null;

  printSummary(divergence, conflicts);

  const violations = evaluateBudgets({ divergence, conflicts, budgets: config.budgets });
  if (violations.length === 0) {
    console.log("upstream-sync check passed: divergence stays within budget.");
    return;
  }

  console.error("upstream-sync check failed:");
  for (const violation of violations) console.error(`- ${violation}`);
  console.error("Shrink the change instead of raising the budget; see docs/upstream-sync.md.");
  process.exitCode = 1;
}

async function runResolve(): Promise<void> {
  const config = await loadConfig();
  const mergeHead = git(["rev-parse", "--git-path", "MERGE_HEAD"]);
  const mergeHeadPath = mergeHead.stdout.trim();
  if (mergeHead.status !== 0 || mergeHeadPath === "" || !existsSync(path.resolve(repoRoot, mergeHeadPath))) {
    throw new Error("no merge in progress; start 'git merge --no-ff --no-commit <upstream-ref>' first");
  }

  const conflicted = git(["diff", "--name-only", "--diff-filter=U"]);
  const conflictedPaths = conflicted.stdout.split(/\r?\n/).filter((line) => line.trim() !== "");
  const targets = selectKeepDeletedResolutions(conflictedPaths, config.keepDeletedPaths);
  if (targets.length === 0) {
    console.log("no configured deletions are conflicted in this merge");
    return;
  }

  for (const target of targets) {
    const removal = git(["rm", "-q", "--", target]);
    if (removal.status !== 0) {
      throw new Error(`could not keep ${target} deleted: ${removal.stderr.trim()}`);
    }
    console.log(`kept deleted: ${target}`);
  }
}

const helpText = [
  "upstream-sync commands:",
  "  report  [--upstream <ref>] [--input <merge-tree-output>] [--out <file>] [--json]",
  "  check   [--upstream <ref>] [--conflicts]",
  "  resolve  (during a merge: keep the configured deletions deleted)",
  "",
  "The report runs a real merge in memory (git merge-tree) and never touches the worktree.",
].join("\n");

const options = parseArgs(process.argv.slice(2));
if (options.command === "help") {
  console.log(helpText);
} else if (options.command === "report") {
  await runReport(options);
} else if (options.command === "check") {
  await runCheck(options);
} else if (options.command === "resolve") {
  await runResolve();
} else {
  console.error(`unknown command: ${String(options.command)}`);
  console.error(helpText);
  process.exitCode = 1;
}
