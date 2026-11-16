import { describe, expect, test } from "vitest";

import {
  actionForCategory,
  classifyPath,
  evaluateBudgets,
  globToRegExp,
  isOwnedPath,
  parseMergeTreeOutput,
  renderInventoryReport,
  selectKeepDeletedResolutions,
  summarizeConflicts,
  summarizeDivergence,
  type SyncBudgets,
} from "../../../scripts/lib/upstream-sync.ts";

// Shape mirrors `git merge-tree --write-tree --name-only --messages`: an
// optional tree oid, the conflicted paths, a blank line, then message lines.
const sampleOutput = [
  "4c8728eb96e1e32967ce0c825d88266ff9df3548",
  "apps/daemon/src/server.ts",
  "apps/web/src/components/CommunityView.tsx",
  "apps/web/src/i18n/locales/en.ts",
  "apps/web/tests/components/home-hero/TypePillRow.test.tsx",
  "",
  "Auto-merging .gitignore",
  "Auto-merging apps/daemon/package.json",
  "CONFLICT (content): Merge conflict in apps/daemon/src/server.ts",
  "CONFLICT (content): Merge conflict in apps/web/src/i18n/locales/en.ts",
  "CONFLICT (modify/delete): apps/web/src/components/CommunityView.tsx deleted in HEAD and modified in upstream/main.  Version upstream/main of apps/web/src/components/CommunityView.tsx left in tree.",
  "CONFLICT (modify/delete): apps/web/tests/components/home-hero/TypePillRow.test.tsx deleted in upstream/main and modified in HEAD.  Version HEAD of apps/web/tests/components/home-hero/TypePillRow.test.tsx left in tree.",
].join("\n");

const budgets: SyncBudgets = {
  upstreamOwnedFiles: 644,
  mergeConflicts: 120,
  modifyDeleteConflicts: 10,
};

describe("parseMergeTreeOutput", () => {
  test("separates the tree oid, conflict paths, and messages", () => {
    const inventory = parseMergeTreeOutput(sampleOutput);

    expect(inventory.treeOid).toBe("4c8728eb96e1e32967ce0c825d88266ff9df3548");
    expect(inventory.autoMerged).toEqual([".gitignore", "apps/daemon/package.json"]);
    expect(inventory.conflicts.map((conflict) => conflict.path)).toEqual([
      "apps/daemon/src/server.ts",
      "apps/web/src/components/CommunityView.tsx",
      "apps/web/src/i18n/locales/en.ts",
      "apps/web/tests/components/home-hero/TypePillRow.test.tsx",
    ]);
  });

  test("records which side deleted a modify/delete conflict", () => {
    const inventory = parseMergeTreeOutput(sampleOutput);
    const byPath = new Map(inventory.conflicts.map((conflict) => [conflict.path, conflict]));

    expect(byPath.get("apps/daemon/src/server.ts")).toMatchObject({
      kind: "content",
      deletedIn: null,
    });
    expect(byPath.get("apps/web/src/components/CommunityView.tsx")).toMatchObject({
      kind: "modify-delete",
      deletedIn: "ours",
    });
    expect(byPath.get("apps/web/tests/components/home-hero/TypePillRow.test.tsx")).toMatchObject({
      kind: "modify-delete",
      deletedIn: "theirs",
    });
  });

  test("treats a missing tree oid as a plain conflict list", () => {
    const inventory = parseMergeTreeOutput(["a.ts", "b.ts", ""].join("\n"));

    expect(inventory.treeOid).toBeNull();
    expect(inventory.conflicts.map((conflict) => conflict.path)).toEqual(["a.ts", "b.ts"]);
    expect(inventory.conflicts.every((conflict) => conflict.kind === "content")).toBe(true);
  });

  test("returns an empty inventory for a clean merge", () => {
    const inventory = parseMergeTreeOutput(["0123456789abcdef0123456789abcdef01234567", ""].join("\n"));

    expect(inventory.conflicts).toEqual([]);
    expect(inventory.autoMerged).toEqual([]);
  });
});

describe("classifyPath", () => {
  test.each([
    ["apps/web/src/i18n/locales/en.ts", "locale"],
    ["plugins/_official/scenarios/x/assets/core-system-prompt.md", "prompt-asset"],
    ["packages/contracts/src/prompts/system.ts", "prompt-asset"],
    ["apps/web/tests/components/HomeView.prefill.test.tsx", "test"],
    ["e2e/ui/amr-onboarding.test.ts", "test"],
    ["packages/contracts/tests/nextore/edition.test.ts", "test"],
    ["packages/contracts/src/api/projects.ts", "contract"],
    ["docs/architecture.md", "docs"],
    ["README.md", "root"],
    ["apps/daemon/src/server.ts", "source"],
  ])("classifies %s as %s", (repositoryPath, expected) => {
    expect(classifyPath(repositoryPath)).toBe(expected);
  });
});

describe("actionForCategory", () => {
  test("only locale conflicts are safe to script", () => {
    expect(actionForCategory("locale")).toBe("scripted");
    expect(actionForCategory("test")).toBe("take-upstream");
    expect(actionForCategory("docs")).toBe("take-upstream");
    expect(actionForCategory("prompt-asset")).toBe("review");
    expect(actionForCategory("contract")).toBe("review");
    expect(actionForCategory("source")).toBe("review");
    expect(actionForCategory("root")).toBe("review");
  });
});

describe("summarizeConflicts", () => {
  test("counts by kind, category, and action", () => {
    const summary = summarizeConflicts(parseMergeTreeOutput(sampleOutput).conflicts);

    expect(summary.total).toBe(4);
    expect(summary.byKind).toEqual({ content: 2, "modify-delete": 2, unknown: 0 });
    expect(summary.byCategory.locale).toBe(1);
    expect(summary.byCategory.source).toBe(2);
    expect(summary.byCategory.test).toBe(1);
    expect(summary.byAction.review).toBe(2);
    expect(summary.byAction.scripted).toBe(1);
    expect(summary.byAction["take-upstream"]).toBe(1);
    expect(summary.modifyDelete).toHaveLength(2);
  });
});

describe("keep-deleted policy", () => {
  test("classifies configured deletions as keep-deleted", () => {
    const conflicts = parseMergeTreeOutput(sampleOutput).conflicts;
    const summary = summarizeConflicts(conflicts, {
      keepDeletedPaths: ["apps/web/src/components/CommunityView.tsx"],
    });

    expect(summary.byAction["keep-deleted"]).toBe(1);
    expect(summary.byAction.review).toBe(1);
  });

  test("selects only conflicted paths that are configured for deletion", () => {
    expect(
      selectKeepDeletedResolutions(
        ["apps/web/tests/a.test.tsx", "apps/web/src/server.ts", "apps/web/tests/a.test.tsx"],
        ["apps/web/tests/a.test.tsx", "apps/web/tests/b.test.tsx"],
      ),
    ).toEqual(["apps/web/tests/a.test.tsx"]);
  });

  test("returns nothing when no configured deletion is conflicted", () => {
    expect(
      selectKeepDeletedResolutions(["apps/web/src/server.ts"], ["apps/web/tests/a.test.tsx"]),
    ).toEqual([]);
  });
});

describe("globToRegExp", () => {
  test("supports single-segment and recursive wildcards", () => {
    expect(globToRegExp("apps/*/src/*.ts").test("apps/web/src/App.ts")).toBe(true);
    expect(globToRegExp("apps/*/src/*.ts").test("apps/web/src/deep/App.ts")).toBe(false);
    expect(globToRegExp("apps/daemon/src/nextore/**").test("apps/daemon/src/nextore/auth/routes.ts")).toBe(true);
    expect(globToRegExp("apps/daemon/src/nextore-*.ts").test("apps/daemon/src/nextore-gc.ts")).toBe(true);
    expect(globToRegExp("deploy/**").test("deploy/nextore/linux/install.sh")).toBe(true);
  });

  test("escapes regex metacharacters in literal segments", () => {
    expect(globToRegExp("docs/a+b.md").test("docs/a+b.md")).toBe(true);
    expect(globToRegExp("docs/a+b.md").test("docs/aab.md")).toBe(false);
  });

  test("isOwnedPath accepts any matching glob", () => {
    const globs = ["apps/web/src/nextore/**", "deploy/**"];
    expect(isOwnedPath("apps/web/src/nextore/session.ts", globs)).toBe(true);
    expect(isOwnedPath("deploy/nextore/Dockerfile", globs)).toBe(true);
    expect(isOwnedPath("apps/web/src/components/App.tsx", globs)).toBe(false);
  });
});

describe("summarizeDivergence", () => {
  test("splits fork-owned from upstream-owned files and ranks areas", () => {
    const divergence = summarizeDivergence({
      changedFiles: [
        "apps/web/src/nextore/session.ts",
        "apps/web/src/components/App.tsx",
        "apps/web/src/components/HomeView.tsx",
        "apps/daemon/src/server.ts",
        "deploy/nextore/Dockerfile",
        "README.md",
      ],
      ownedPathGlobs: ["apps/web/src/nextore/**", "deploy/**"],
    });

    expect(divergence.changed).toBe(6);
    expect(divergence.owned).toBe(2);
    expect(divergence.upstreamOwned).toBe(4);
    expect(divergence.upstreamOwnedByArea).toEqual([
      { area: "apps/web", count: 2 },
      { area: "apps/daemon", count: 1 },
      { area: "(root)", count: 1 },
    ]);
  });
});

describe("evaluateBudgets", () => {
  const divergence = summarizeDivergence({
    changedFiles: Array.from({ length: 5 }, (_, index) => `apps/web/src/components/File${index}.tsx`),
    ownedPathGlobs: [],
  });

  test("passes while divergence stays inside budget", () => {
    expect(evaluateBudgets({ divergence, conflicts: null, budgets })).toEqual([]);
  });

  test("fails when upstream-owned divergence exceeds budget", () => {
    const violations = evaluateBudgets({
      divergence,
      conflicts: null,
      budgets: { ...budgets, upstreamOwnedFiles: 4 },
    });

    expect(violations).toEqual([expect.stringContaining("upstream-owned divergent files: 5 > budget 4")]);
  });

  test("fails when conflict counts exceed budget", () => {
    const conflicts = summarizeConflicts(parseMergeTreeOutput(sampleOutput).conflicts);
    const violations = evaluateBudgets({
      divergence,
      conflicts,
      budgets: { ...budgets, mergeConflicts: 1, modifyDeleteConflicts: 1 },
    });

    expect(violations).toEqual([
      expect.stringContaining("merge conflicts: 4 > budget 1"),
      expect.stringContaining("modify/delete conflicts: 2 > budget 1"),
    ]);
  });
});

describe("renderInventoryReport", () => {
  test("renders the conflict table, modify/delete list, and divergence areas", () => {
    const conflicts = summarizeConflicts(parseMergeTreeOutput(sampleOutput).conflicts);
    const divergence = summarizeDivergence({
      changedFiles: ["apps/web/src/components/App.tsx", "apps/web/src/nextore/session.ts"],
      ownedPathGlobs: ["apps/web/src/nextore/**"],
    });

    const markdown = renderInventoryReport({
      upstreamRef: "upstream/main",
      upstreamCommit: "59e4f2a",
      capturedAt: "2026-11-16",
      conflicts,
      divergence,
    });

    expect(markdown).toContain("# Upstream sync inventory");
    expect(markdown).toContain("Conflicts: **4**");
    expect(markdown).toContain("| `locale` | 1 | `scripted` |");
    expect(markdown).toContain("## Modify/delete conflicts");
    expect(markdown).toContain("deleted downstream");
    expect(markdown).toContain("deleted upstream");
    expect(markdown).toContain("## Fork divergence in upstream-owned files");
  });

  test("is deterministic for identical input", () => {
    const conflicts = summarizeConflicts(parseMergeTreeOutput(sampleOutput).conflicts);
    const divergence = summarizeDivergence({ changedFiles: [], ownedPathGlobs: [] });
    const input = {
      upstreamRef: "upstream/main",
      upstreamCommit: "59e4f2a",
      capturedAt: "2026-11-16",
      conflicts,
      divergence,
    };

    expect(renderInventoryReport(input)).toBe(renderInventoryReport(input));
  });
});
