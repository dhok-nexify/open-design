/** P04 rollout mode. Unknown values fail closed to off. */
export type NextoreArtifactAuthorityMode = 'off' | 'publish' | 'publish+share';

export function resolveNextoreArtifactAuthorityMode(
  env: NodeJS.ProcessEnv = process.env,
): NextoreArtifactAuthorityMode {
  const raw = env.NEXTORE_ARTIFACT_AUTHORITY?.trim().toLowerCase();
  if (!raw || raw === 'off' || raw === '0' || raw === 'false') return 'off';
  if (raw === 'publish' || raw === '1' || raw === 'true') return 'publish';
  if (raw === 'publish+share' || raw === 'publish_share' || raw === 'share') return 'publish+share';
  return 'off';
}

export function isNextoreArtifactPublishEnabled(mode: NextoreArtifactAuthorityMode): boolean {
  return mode === 'publish' || mode === 'publish+share';
}

export function isNextoreArtifactShareEnabled(mode: NextoreArtifactAuthorityMode): boolean {
  return mode === 'publish+share';
}
