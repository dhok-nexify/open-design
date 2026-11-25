#!/usr/bin/env node

/**
 * The NexTore Designer entry point for the daemon CLI.
 *
 * The upstream CLI is written as `od`, and that word appears in several hundred
 * help lines, hints and error messages inside `apps/daemon/src/cli.ts`. Editing
 * those would turn every upstream change to the CLI into a merge conflict, so
 * the NexTore name is applied here instead: this entry marks the process as
 * `nd` and rewrites the handful of places where the CLI names itself. The
 * source stays upstream-shaped; only this file knows about the second name.
 */
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const name = "nd";
process.env.OD_CLI_NAME = name;

const entryDir = dirname(fileURLToPath(import.meta.url));
const distEntry = resolve(entryDir, "../dist/cli.js");

if (!existsSync(distEntry)) {
  throw new Error(
    `NexTore Designer daemon dist entry not found at ${distEntry}. Run "pnpm bootstrap" after install (or "pnpm --filter @open-design/daemon build").`,
  );
}

/**
 * Rewrite only command references: a usage line that starts with `od` and the
 * inline hints this CLI emits ("Run: od auth login", `od auth login`). Prose
 * that merely contains the word (for example "for od or node") is untouched.
 */
function brandLine(line) {
  return line
    .replace(/^(\s*Usage:\s+)od\b/, `$1${name}`)
    .replace(/^(\s*)od(\s)/, `$1${name}$2`)
    .replace(/\bod(?=\s+(?:auth|nextore)\b)/g, name)
    .replace(/\bfor od or\b/g, `for ${name} or`);
}

/** Line-buffered so a rewrite never depends on how the writes were split. */
function brandStream(stream) {
  let pending = "";
  const originalWrite = stream.write.bind(stream);
  stream.write = (chunk, encoding, callback) => {
    if (typeof chunk !== "string") return originalWrite(chunk, encoding, callback);
    pending += chunk;
    const parts = pending.split("\n");
    pending = parts.pop() ?? "";
    if (parts.length === 0) {
      if (typeof callback === "function") callback();
      return true;
    }
    const text = parts.map((part) => brandLine(part) + "\n").join("");
    return originalWrite(text, encoding, callback);
  };
  const flush = () => {
    if (!pending) return;
    const text = brandLine(pending);
    pending = "";
    originalWrite(text);
  };
  process.once("exit", flush);
}

brandStream(process.stdout);
brandStream(process.stderr);

await import(pathToFileURL(distEntry).href);
