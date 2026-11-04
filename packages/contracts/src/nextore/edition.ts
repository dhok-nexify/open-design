export const EDITIONS = ['upstream', 'nextore'] as const;

export type Edition = (typeof EDITIONS)[number];

/**
 * Product surfaces that are intentionally unavailable in the NexTore edition.
 * Keep this list pure so both the web client and daemon use the same contract.
 */
export const NEXTORE_DISABLED_FEATURES = [
  'onboarding',
  'cloud-amr',
  'campaigns',
  'telemetry',
  'whats-new',
  'updater',
  'privacy-consent',
  'survey',
  'github-metadata',
  'discord',
  'attribution',
  'social-share',
  'community',
  'marketplace-remote',
  'connectors',
  'deploy',
  'handoff-cli',
  'research-tavily',
  'xai',
  'pets',
  'collab-cloud',
  'byok-settings',
  'agent-picker',
  'media-providers',
  'terminals',
  'host-tools',
  'native-dialog',
  'library-clipper',
  'orbit',
  'od-mcp-server',
  'stdio-mcp',
  'design-browser',
  'figma',
  'automations',
  'hyperframes',
  'od-next',
  'media-generation',
] as const;

export type NextoreFeature = (typeof NEXTORE_DISABLED_FEATURES)[number];

const NEXTORE_DISABLED_FEATURE_SET: ReadonlySet<string> = new Set(NEXTORE_DISABLED_FEATURES);

/**
 * Resolve the product edition once at a process or build boundary.
 *
 * Missing and empty values retain upstream behavior. Unknown values fail
 * closed instead of silently enabling features the operator did not request.
 */
export function resolveEdition(value: string | null | undefined): Edition {
  const normalized = value?.trim();
  if (!normalized || normalized === 'upstream') return 'upstream';
  if (normalized === 'nextore') return 'nextore';
  throw new Error(
    `Unsupported edition "${normalized}". Expected one of: ${EDITIONS.join(', ')}.`,
  );
}

export function isNextoreFeatureEnabled(edition: Edition, feature: NextoreFeature): boolean {
  return edition !== 'nextore' || !NEXTORE_DISABLED_FEATURE_SET.has(feature);
}
