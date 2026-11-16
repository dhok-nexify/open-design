// Parse the locale registry's literal maps without importing app code.
//
// The registry lives in the bundler-resolved web app, so the NodeNext scripts
// program must not import it. Reading its two exported maps as text keeps the
// i18n check honest while staying independent of the app module graph.

export function extractObjectKeys(source: string, mapName: string): string[] {
  const anchorIndex = source.indexOf(`export const ${mapName}`);
  if (anchorIndex < 0) return [];
  const openIndex = source.indexOf("{", anchorIndex);
  if (openIndex < 0) return [];

  let depth = 0;
  let endIndex = -1;
  for (let index = openIndex; index < source.length; index += 1) {
    const character = source[index];
    if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        endIndex = index;
        break;
      }
    }
  }
  if (endIndex < 0) return [];

  const keys: string[] = [];
  let localDepth = 0;
  for (const line of source.slice(openIndex + 1, endIndex).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (localDepth === 0) {
      const match = /^(?:'([^']+)'|"([^"]+)"|([A-Za-z][\w-]*)):\s/.exec(trimmed);
      if (match) keys.push(match[1] ?? match[2] ?? match[3] ?? "");
    }
    for (const character of line) {
      if (character === "{" || character === "(" || character === "[") localDepth += 1;
      else if (character === "}" || character === ")" || character === "]") localDepth -= 1;
    }
  }
  return keys.filter((key) => key.length > 0);
}
