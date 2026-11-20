import assert from "node:assert/strict";
import { test } from "vitest";

import {
  findMissing,
  formatBytes,
  isSafeKey,
  previewFiles,
} from "../../../scripts/fetch-plugin-previews.ts";

// The Nextore package only resolves a baked preview when both clip files exist
// on disk, so the build step that materializes them has to be exact: every
// manifest entry expanded, nothing skipped silently, and no key able to write
// outside the previews directory.

test("expands each manifest entry into its video and poster keys", () => {
  const { files, problems } = previewFiles({
    generatedAt: null,
    previews: {
      "example-a": { video: "example-a/abc/preview.mp4", poster: "example-a/abc/poster.jpg" },
    },
  });
  assert.deepEqual(problems, []);
  assert.deepEqual(files.map((file) => file.kind), ["video", "poster"]);
  assert.deepEqual(files.map((file) => file.key), [
    "example-a/abc/preview.mp4",
    "example-a/abc/poster.jpg",
  ]);
  assert.equal(files[0]!.id, "example-a");
});

test("reports malformed entries instead of dropping them", () => {
  const { files, problems } = previewFiles({
    previews: { "example-b": { video: "example-b/abc/preview.mp4" } },
  });
  assert.equal(files.length, 1);
  assert.equal(problems.length, 1);
  assert.match(problems[0]!, /example-b: missing "poster"/);
});

test("reports a manifest with no previews instead of passing the gate", () => {
  const { files, problems } = previewFiles({ generatedAt: null });
  assert.equal(files.length, 0);
  assert.match(problems[0]!, /no "previews" object/);
});

test("rejects keys that could escape the output directory", () => {
  assert.equal(isSafeKey("example-a/abc/preview.mp4"), true);
  assert.equal(isSafeKey("../outside.mp4"), false);
  assert.equal(isSafeKey("/abs/preview.mp4"), false);
  assert.equal(isSafeKey("example-a\\abc\\preview.mp4"), false);
  assert.equal(isSafeKey("example-a//preview.mp4"), false);
});

test("findMissing treats absent and zero-byte files as missing", async () => {
  const files = [
    { id: "a", key: "a/v.mp4", kind: "video" as const },
    { id: "a", key: "a/p.jpg", kind: "poster" as const },
    { id: "b", key: "b/v.mp4", kind: "video" as const },
  ];
  const missing = await findMissing(files, "/out", async (filePath) => {
    const key = filePath.split(/[\\/]/).slice(-2).join("/");
    if (key === "a/v.mp4") return 10;
    if (key === "a/p.jpg") return 0;
    return null;
  });
  assert.deepEqual(missing.map((file) => file.key), ["a/p.jpg", "b/v.mp4"]);
});

test("formatBytes keeps the build log readable", () => {
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(2048), "2.0 KB");
  assert.equal(formatBytes(3 * 1024 * 1024), "3.0 MB");
});
