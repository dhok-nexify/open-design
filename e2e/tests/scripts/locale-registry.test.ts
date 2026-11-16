import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import { extractObjectKeys } from "../../../scripts/lib/locale-registry.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const sample = [
  "export const eagerDicts: Partial<Record<Locale, Dict>> = {",
  "  en: enDict,",
  "  'zh-CN': zhCNDict,",
  "};",
  "",
  "export const dictLoaders: Partial<Record<Locale, DictLoader>> = {",
  "  id: () => Promise.all([import('../locales/id'), import('./locales/id')])",
  "    .then(([base, overlay]) => withOverlay(base.id, overlay.idOverlay)),",
  "  'pt-BR': () => Promise.all([import('../locales/pt-BR'), import('./locales/pt-BR')])",
  "    .then(([base, overlay]) => withOverlay(base.ptBR, overlay.ptBROverlay)),",
  "};",
].join("\n");

describe("extractObjectKeys", () => {
  test("reads top-level keys from both registry maps", () => {
    expect(extractObjectKeys(sample, "eagerDicts")).toEqual(["en", "zh-CN"]);
    expect(extractObjectKeys(sample, "dictLoaders")).toEqual(["id", "pt-BR"]);
  });

  test("ignores nested properties and missing maps", () => {
    expect(extractObjectKeys(sample, "missing")).toEqual([]);
    expect(
      extractObjectKeys(
        ["export const eagerDicts = {", "  a: {", "    b: 1,", "  },", "  c: 2,", "};"].join("\n"),
        "eagerDicts",
      ),
    ).toEqual(["a", "c"]);
  });

  test("the live registry covers every supported locale", () => {
    const source = readFileSync(
      path.join(repoRoot, "apps/web/src/i18n/nextore/registry.ts"),
      "utf8",
    );
    const registered = new Set([
      ...extractObjectKeys(source, "eagerDicts"),
      ...extractObjectKeys(source, "dictLoaders"),
    ]);
    expect(registered.size).toBe(19);
    expect(registered.has("en")).toBe(true);
    expect(registered.has("zh-CN")).toBe(true);
    expect(registered.has("it")).toBe(true);
  });
});
