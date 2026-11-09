/**
 * Project-level network policy for a previewed artifact (NXD-D25 follow-up).
 *
 * The edition's default is `connect-src 'none'`: an artifact renders with its
 * own inline data but may not reach the daemon API. A project can opt into the
 * narrow `same-origin-readonly` policy for artifacts that genuinely load their
 * own data files: GET/HEAD only, same origin only, and only under the path
 * prefixes the project lists in its metadata.
 *
 * CSP cannot express a method or a path limit, so the meta relaxes
 * `connect-src` to 'self' and an injected guard enforces the rest before any
 * authored script runs. The guard embeds {@link artifactNetworkRequestAllowed}
 * verbatim, so that one function is the single source of truth for the rule.
 */
export type ArtifactNetworkPolicy = 'none' | 'same-origin-readonly';

export interface ArtifactNetworkRules {
  policy: ArtifactNetworkPolicy;
  /** Same-origin path prefixes the artifact may read, each normalized to end with '/'. */
  paths: readonly string[];
}

export const ARTIFACT_NETWORK_NONE: ArtifactNetworkRules = { policy: 'none', paths: [] };

const MAX_PATHS = 16;
const MAX_PATH_LENGTH = 512;

/**
 * A usable prefix is a rooted path with no traversal, no query/fragment and no
 * characters that could close the <script> the guard is embedded in.
 */
function normalizePathPrefix(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const path = value.trim();
  if (!path.startsWith('/') || path.startsWith('//')) return null;
  if (path.length < 2 || path.length > MAX_PATH_LENGTH) return null;
  if (path.includes('..') || path.includes('\\') || path.includes('?') || path.includes('#')) return null;
  if (/[<>"'\u0000-\u001f\u0020]/.test(path)) return null;
  return path.endsWith('/') ? path : path + '/';
}

/**
 * Read the opt-in out of project metadata. Anything unexpected — a different
 * policy name, no usable path, a malformed list — keeps the strict default,
 * because the failure mode of guessing must never be "network allowed".
 */
export function resolveArtifactNetworkRules(metadata: unknown): ArtifactNetworkRules {
  if (!metadata || typeof metadata !== 'object') return ARTIFACT_NETWORK_NONE;
  const meta = metadata as Record<string, unknown>;
  if (meta.artifactNetwork !== 'same-origin-readonly') return ARTIFACT_NETWORK_NONE;
  const raw = Array.isArray(meta.artifactNetworkPaths) ? meta.artifactNetworkPaths : [];
  const paths: string[] = [];
  for (const entry of raw.slice(0, MAX_PATHS)) {
    const prefix = normalizePathPrefix(entry);
    if (prefix && !paths.includes(prefix)) paths.push(prefix);
  }
  // Opting in without a usable path would silently read as "network allowed".
  if (paths.length === 0) return ARTIFACT_NETWORK_NONE;
  return { policy: 'same-origin-readonly', paths };
}

/**
 * The whole read-only network rule, as one self-contained function.
 *
 * Keep this ES5-shaped and dependency-free: its source text is embedded in the
 * preview document and re-parsed there, so anything it referenced from module
 * scope would be missing at runtime. Never call it with attacker-controlled
 * values outside that embedded guard without expecting {@link URL} to throw.
 */
export function artifactNetworkRequestAllowed(input: {
  paths: readonly string[];
  base: string;
  url: string;
  method: string;
}): boolean {
  var method = String(input.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') return false;
  var base: URL;
  var target: URL;
  try {
    base = new URL(input.base);
    target = new URL(input.url, base);
  } catch (error) {
    return false;
  }
  if (target.origin !== base.origin) return false;
  var path = target.pathname;
  for (var i = 0; i < input.paths.length; i += 1) {
    var prefix = input.paths[i] || '';
    if (!prefix) continue;
    if (path === prefix.slice(0, -1) || path.indexOf(prefix) === 0) return true;
  }
  return false;
}

/**
 * The script injected next to the relaxed meta. It installs before any authored
 * script (the caller inserts it at document start) and neutralizes every
 * outbound channel an artifact could use: fetch, XHR, WebSocket, EventSource
 * and sendBeacon.
 */
export function buildArtifactNetworkGuardScript(rules: ArtifactNetworkRules): string {
  const paths = JSON.stringify(rules.paths);
  return '<script data-od-artifact-network="guard">(function(){'
    + 'var PATHS=' + paths + ';'
    + 'var check=' + artifactNetworkRequestAllowed.toString() + ';'
    + 'function allowed(url,method){return check({paths:PATHS,base:document.baseURI,url:String(url),method:String(method||"GET")});}'
    + 'function blocked(){return new TypeError("Blocked by the project artifact network policy");}'
    + 'var nativeFetch=window.fetch;'
    + 'if(typeof nativeFetch==="function"){window.fetch=function(input,init){'
    + 'var url=typeof input==="string"?input:(input&&input.url)||"";'
    + 'var method=(init&&init.method)||(input&&input.method)||"GET";'
    + 'if(!allowed(url,method))return Promise.reject(blocked());'
    + 'return nativeFetch.apply(this,arguments);};}'
    + 'var nativeOpen=window.XMLHttpRequest&&window.XMLHttpRequest.prototype.open;'
    + 'if(typeof nativeOpen==="function"){window.XMLHttpRequest.prototype.open=function(method,url){'
    + 'if(!allowed(url,method))throw blocked();'
    + 'return nativeOpen.apply(this,arguments);};}'
    + 'function refuse(){throw blocked();}'
    + 'window.WebSocket=refuse;window.EventSource=refuse;'
    + 'if(navigator.sendBeacon){navigator.sendBeacon=function(){return false;};}'
    + '})();</script>';
}
