// Upstream-sync inventory: pure parsing, classification, and budget logic.
//
// The CLI in `scripts/upstream-sync.ts` owns git and process effects. Keeping
// this module pure lets conflict policy be unit tested without a checkout and
// keeps the guard architecture contract (scripts/lib must stay effect free).

export type ConflictKind = "content" | "modify-delete" | "unknown";

export type ConflictOwner = "ours" | "theirs";

export type ConflictCategory =
  | "locale"
  | "prompt-asset"
  | "test"
  | "contract"
  | "docs"
  | "root"
  | "source";

export type ConflictAction = "scripted" | "take-upstream" | "keep-deleted" | "review";

export type MergeConflict = {
  path: string;
  kind: ConflictKind;
  // Only populated for modify/delete conflicts: which side removed the file.
  deletedIn: ConflictOwner | null;
};

export type MergeTreeInventory = {
  treeOid: string | null;
  conflicts: MergeConflict[];
  autoMerged: string[];
};

export type SyncBudgets = {
  // Files the downstream fork edits that upstream owns. Lowering this number
  // is progress; raising it needs an explicit, reviewed decision.
  upstreamOwnedFiles: number;
  mergeConflicts: number;
  modifyDeleteConflicts: number;
};

export type SyncConfig = {
  upstreamRef: string;
  budgets: SyncBudgets;
  // Globs for areas the fork owns outright. Anything outside them is debt.
  ownedPathGlobs: string[];
  // Paths the fork deliberately removed. A merge that sees upstream touch them
  // is resolved by keeping the deletion instead of asking a human again.
  keepDeletedPaths: string[];
};

export type DivergenceSummary = {
  changed: number;
  owned: number;
  upstreamOwned: number;
  upstreamOwnedByArea: Array<{ area: string; count: number }>;
};

export type ConflictSummary = {
  total: number;
  byKind: Record<ConflictKind, number>;
  byCategory: Record<ConflictCategory, number>;
  byAction: Record<ConflictAction, number>;
  modifyDelete: MergeConflict[];
  paths: string[];
};

const treeOidPattern = /^[0-9a-f]{40,64}$/;
const contentConflictPattern = /^CONFLICT \(content\): Merge conflict in (.+)$/;
const modifyDeletePrefix = "CONFLICT (modify/delete): ";
const autoMergingPattern = /^Auto-merging (.+)$/;

function emptyKindCounts(): Record<ConflictKind, number> {
  return { content: 0, "modify-delete": 0, unknown: 0 };
}

function emptyCategoryCounts(): Record<ConflictCategory, number> {
  return {
    locale: 0,
    "prompt-asset": 0,
    test: 0,
    contract: 0,
    docs: 0,
    root: 0,
    source: 0,
  };
}

function emptyActionCounts(): Record<ConflictAction, number> {
  return { scripted: 0, "take-upstream": 0, "keep-deleted": 0, review: 0 };
}

/**
 * Parse `git merge-tree --write-tree --name-only --messages` output.
 *
 * The porcelain shape is: optional tree oid, a block of conflicted paths, then
 * informational lines that name the conflict type and the auto-merged files.
 */
export function parseMergeTreeOutput(raw: string): MergeTreeInventory {
  const lines = raw.split(/\r?\n/);
  let index = 0;
  let treeOid: string | null = null;

  const first = lines[0];
  if (first !== undefined && treeOidPattern.test(first.trim())) {
    treeOid = first.trim();
    index = 1;
  }

  const conflictPaths: string[] = [];
  while (index < lines.length) {
    const line = lines[index] ?? "";
    index += 1;
    if (line.trim() === "") break;
    conflictPaths.push(line.trim());
  }

  const details = new Map<string, MergeConflict>();
  const autoMerged: string[] = [];
  for (; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const auto = autoMergingPattern.exec(line);
    if (auto?.[1] !== undefined) {
      autoMerged.push(auto[1].trim());
      continue;
    }
    const content = contentConflictPattern.exec(line);
    if (content?.[1] !== undefined) {
      const conflictPath = content[1].trim();
      details.set(conflictPath, { path: conflictPath, kind: "content", deletedIn: null });
      continue;
    }
    if (line.startsWith(modifyDeletePrefix)) {
      // Shape: "<path> deleted in <side> and modified in <side>. Version ..."
      // Paths contain dots, so split on the fixed phrases instead of a regex.
      const body = line.slice(modifyDeletePrefix.length);
      const deletedAt = body.indexOf(" deleted in ");
      const modifiedAt = body.indexOf(" and modified in ", deletedAt);
      if (deletedAt > 0 && modifiedAt > deletedAt) {
        const conflictPath = body.slice(0, deletedAt).trim();
        const modifiedIn = body.slice(modifiedAt + " and modified in ".length).split(".")[0]?.trim() ?? "";
        // Whichever side is not HEAD is upstream; the deleted side is the other.
        const deletedIn: ConflictOwner = modifiedIn === "HEAD" ? "theirs" : "ours";
        details.set(conflictPath, { path: conflictPath, kind: "modify-delete", deletedIn });
      }
    }
  }

  const conflicts: MergeConflict[] = conflictPaths.map((conflictPath) => {
    const detail = details.get(conflictPath);
    if (detail !== undefined) return detail;
    const fallback: MergeConflict = { path: conflictPath, kind: "content", deletedIn: null };
    return fallback;
  });

  conflicts.sort((left, right) => left.path.localeCompare(right.path));
  autoMerged.sort((left, right) => left.localeCompare(right));

  return { treeOid, conflicts, autoMerged };
}

/**
 * Classify a conflicted path so each conflict gets a default resolution route.
 * Order matters: a contract test is a test, a prompt asset under docs is a
 * prompt asset.
 */
export function classifyPath(repositoryPath: string): ConflictCategory {
  if (/\/i18n\/locales\/[^/]+$/.test(repositoryPath)) return "locale";
  if (repositoryPath.startsWith("plugins/_official/") || repositoryPath.includes("/prompts/")) {
    return "prompt-asset";
  }
  if (repositoryPath.includes("/tests/") || repositoryPath.includes("/test/") ||
    /\.(?:test|spec)\.[^/]+$/.test(repositoryPath)) {
    return "test";
  }
  if (repositoryPath.startsWith("packages/contracts/")) return "contract";
  if (repositoryPath.startsWith("docs/")) return "docs";
  if (!repositoryPath.includes("/")) return "root";
  if (repositoryPath.endsWith(".md") && repositoryPath.split("/").length === 1) return "docs";
  return "source";
}

/** Default route for a category. Only "scripted" routes are safe to automate. */
export function actionForCategory(category: ConflictCategory): ConflictAction {
  switch (category) {
    case "locale":
      return "scripted";
    case "test":
    case "docs":
      return "take-upstream";
    case "prompt-asset":
    case "contract":
    case "root":
    case "source":
      return "review";
  }
}

export function summarizeConflicts(
  conflicts: readonly MergeConflict[],
  options: { keepDeletedPaths?: readonly string[] } = {},
): ConflictSummary {
  const byKind = emptyKindCounts();
  const byCategory = emptyCategoryCounts();
  const byAction = emptyActionCounts();
  const keepDeleted = new Set(options.keepDeletedPaths ?? []);

  for (const conflict of conflicts) {
    byKind[conflict.kind] += 1;
    const category = classifyPath(conflict.path);
    byCategory[category] += 1;
    byAction[keepDeleted.has(conflict.path) ? "keep-deleted" : actionForCategory(category)] += 1;
  }

  return {
    total: conflicts.length,
    byKind,
    byCategory,
    byAction,
    modifyDelete: conflicts.filter((conflict) => conflict.kind === "modify-delete"),
    paths: conflicts.map((conflict) => conflict.path),
  };
}

/** Convert a repository-relative glob (`*`, `?`, `**`) into a RegExp. */
export function globToRegExp(glob: string): RegExp {
  let pattern = "^";
  for (let index = 0; index < glob.length; index += 1) {
    const character = glob[index] ?? "";
    if (character === "*") {
      if (glob[index + 1] === "*") {
        if (glob[index + 2] === "/") {
          pattern += "(?:.*/)?";
          index += 2;
        } else {
          pattern += ".*";
          index += 1;
        }
      } else {
        pattern += "[^/]*";
      }
      continue;
    }
    if (character === "?") {
      pattern += "[^/]";
      continue;
    }
    pattern += character.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`${pattern}$`);
}

/**
 * Configured deletions that are actually conflicted in the current merge. The
 * caller can then drop exactly these paths; anything else still needs review.
 */
export function selectKeepDeletedResolutions(
  conflictedPaths: readonly string[],
  keepDeletedPaths: readonly string[],
): string[] {
  const configured = new Set(keepDeletedPaths);
  return [...new Set(conflictedPaths.filter((file) => configured.has(file)))]
    .sort((left, right) => left.localeCompare(right));
}

export function isOwnedPath(repositoryPath: string, globs: readonly string[]): boolean {
  return globs.some((glob) => globToRegExp(glob).test(repositoryPath));
}

function areaOf(repositoryPath: string): string {
  const segments = repositoryPath.split("/");
  if (segments.length < 2) return "(root)";
  return segments.slice(0, 2).join("/");
}

/** Split divergent files into fork-owned and upstream-owned, grouped by area. */
export function summarizeDivergence(input: {
  changedFiles: readonly string[];
  ownedPathGlobs: readonly string[];
}): DivergenceSummary {
  const ownedFiles = input.changedFiles.filter((file) => isOwnedPath(file, input.ownedPathGlobs));
  const upstreamOwnedFiles = input.changedFiles.filter((file) => !isOwnedPath(file, input.ownedPathGlobs));

  const areaCounts = new Map<string, number>();
  for (const file of upstreamOwnedFiles) {
    const area = areaOf(file);
    areaCounts.set(area, (areaCounts.get(area) ?? 0) + 1);
  }

  const upstreamOwnedByArea = [...areaCounts.entries()]
    .map(([area, count]) => ({ area, count }))
    .sort((left, right) => {
      if (right.count !== left.count) return right.count - left.count;
      // Keep repository-root files last so the ranked table reads top-down.
      if (left.area === "(root)") return 1;
      if (right.area === "(root)") return -1;
      return left.area.localeCompare(right.area);
    });

  return {
    changed: input.changedFiles.length,
    owned: ownedFiles.length,
    upstreamOwned: upstreamOwnedFiles.length,
    upstreamOwnedByArea,
  };
}

/** Budget violations are the ratchet: they fail when divergence grows. */
export function evaluateBudgets(input: {
  divergence: DivergenceSummary;
  conflicts: ConflictSummary | null;
  budgets: SyncBudgets;
}): string[] {
  const violations: string[] = [];

  if (input.divergence.upstreamOwned > input.budgets.upstreamOwnedFiles) {
    violations.push(
      `upstream-owned divergent files: ${input.divergence.upstreamOwned} > budget ${input.budgets.upstreamOwnedFiles}`,
    );
  }

  const conflicts = input.conflicts;
  if (conflicts !== null) {
    if (conflicts.total > input.budgets.mergeConflicts) {
      violations.push(`merge conflicts: ${conflicts.total} > budget ${input.budgets.mergeConflicts}`);
    }
    const modifyDeleteCount = conflicts.byKind["modify-delete"];
    if (modifyDeleteCount > input.budgets.modifyDeleteConflicts) {
      violations.push(
        `modify/delete conflicts: ${modifyDeleteCount} > budget ${input.budgets.modifyDeleteConflicts}`,
      );
    }
  }

  return violations;
}

const categoryNotes: Record<ConflictCategory, string> = {
  locale: "Apply the key-union overlay; never hand-merge translation files.",
  "prompt-asset": "Read docs/prompt-composition.md before changing prompt text.",
  test: "Take upstream, then adapt assertions to the downstream UI.",
  contract: "Keep additive types in dedicated modules; review shared DTO changes.",
  docs: "Take upstream unless the section is downstream-specific.",
  root: "Review: root manifests and marketing copy usually stay downstream.",
  source: "Review: preserve upstream logic, re-apply the downstream seam.",
};

/** Render the human-facing markdown report. Pure except for the captured date. */
export function renderInventoryReport(input: {
  upstreamRef: string;
  upstreamCommit: string | null;
  capturedAt: string;
  conflicts: ConflictSummary;
  divergence: DivergenceSummary;
}): string {
  const { conflicts, divergence } = input;
  const lines: string[] = [];

  lines.push("# Upstream sync inventory", "");
  lines.push(`- Upstream ref: \`${input.upstreamRef}\``);
  lines.push(`- Upstream commit: \`${input.upstreamCommit ?? "unknown"}\``);
  lines.push(`- Captured at: ${input.capturedAt}`);
  lines.push(
    `- Conflicts: **${conflicts.total}** (content ${conflicts.byKind.content}, modify/delete ${conflicts.byKind["modify-delete"]})`,
  );
  if (conflicts.byAction["keep-deleted"] > 0) {
    lines.push(
      `- Deliberate deletions: **${conflicts.byAction["keep-deleted"]}** (resolved automatically as keep-deleted)`,
    );
  }
  lines.push(
    `- Divergent files: **${divergence.changed}** (fork-owned ${divergence.owned}, upstream-owned ${divergence.upstreamOwned})`,
  );
  lines.push("");

  lines.push("## Conflicts by category", "");
  lines.push("| Category | Conflicts | Default action | Note |");
  lines.push("| --- | ---: | --- | --- |");
  for (const category of Object.keys(categoryNotes) as ConflictCategory[]) {
    const count = conflicts.byCategory[category];
    if (count === 0) continue;
    lines.push(
      `| \`${category}\` | ${count} | \`${actionForCategory(category)}\` | ${categoryNotes[category]} |`,
    );
  }
  lines.push("");

  if (conflicts.modifyDelete.length > 0) {
    lines.push("## Modify/delete conflicts", "");
    for (const conflict of conflicts.modifyDelete) {
      const side = conflict.deletedIn === "ours" ? "deleted downstream" : "deleted upstream";
      lines.push(`- \`${conflict.path}\` — ${side}, modified on the other side`);
    }
    lines.push("");
  }

  if (divergence.upstreamOwnedByArea.length > 0) {
    lines.push("## Fork divergence in upstream-owned files", "");
    lines.push("| Area | Files |");
    lines.push("| --- | ---: |");
    for (const entry of divergence.upstreamOwnedByArea.slice(0, 15)) {
      lines.push(`| \`${entry.area}\` | ${entry.count} |`);
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}
