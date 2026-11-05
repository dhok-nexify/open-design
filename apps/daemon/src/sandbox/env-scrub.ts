/**
 * Variables an agent subprocess must never inherit.
 *
 * The agent runs untrusted model output: it must not be able to read the
 * daemon data root, mint NexTore calls with the deployment's own credentials,
 * or open the session store. Runtime variables the agent genuinely needs
 * (project id, vendor base, the run-scoped BYOK provider config) are left
 * untouched because they are built per run and carry no long-lived secret.
 */
const DENY_EXACT = new Set([
  'OD_DATA_DIR',
  'OD_LEGACY_DATA_DIR',
  'OD_MEDIA_CONFIG_DIR',
  'OD_API_TOKEN',
  'DESIGNER_SECRET',
  'DESIGNER_SECRET_FILE',
  'NEXTORE_CLIENT_SECRET',
  'NEXTORE_API_KEY',
]);

const DENY_PREFIXES = ['NEXTORE_'] as const;

/** Credential-shaped names: *_TOKEN, *_SECRET, *_PASSWORD and their infixes. */
const DENY_PATTERNS: readonly RegExp[] = [
  /(?:^|_)(?:SECRET|TOKEN|PASSWORD|PASSWD)(?:_|$)/i,
];

export function isScrubbedSandboxEnvKey(key: string): boolean {
  if (DENY_EXACT.has(key)) return true;
  if (DENY_PREFIXES.some((prefix) => key.startsWith(prefix))) return true;
  return DENY_PATTERNS.some((pattern) => pattern.test(key));
}

export function scrubSandboxEnv(
  env: Readonly<Record<string, string>>,
): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (isScrubbedSandboxEnvKey(key)) continue;
    next[key] = value;
  }
  return next;
}
