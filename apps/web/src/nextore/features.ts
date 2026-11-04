import {
  type NextoreFeature,
  isNextoreFeatureEnabled,
  resolveEdition,
} from '@open-design/contracts';

export const NEXTORE_WEB_EDITION = resolveEdition(process.env.NEXT_PUBLIC_OD_EDITION);

export function isFeatureEnabled(feature: NextoreFeature): boolean {
  return isNextoreFeatureEnabled(NEXTORE_WEB_EDITION, feature);
}
