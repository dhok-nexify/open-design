'use client';

import { NEXTORE_TIERS, type NextoreTier } from '@open-design/contracts';

/**
 * Fast / Expert selector for the NexTore edition (NXD-D14).
 *
 * These are tier names, not model ids: the module resolves each tier to the
 * model configured on the site, so the UI never needs a model catalogue and the
 * identifier stays stable across deployments.
 */
const TIER_LABELS: Record<NextoreTier, string> = {
  fast: 'Fast',
  expert: 'Expert',
};

const TIER_TITLES: Record<NextoreTier, string> = {
  fast: 'Fast: quicker answers for small edits',
  expert: 'Expert: the stronger model for new work',
};

export function TierToggle({
  value,
  onChange,
  disabled = false,
}: {
  value: NextoreTier;
  onChange: (tier: NextoreTier) => void;
  disabled?: boolean;
}) {
  return (
    <div className="nextore-tier-toggle" role="radiogroup" aria-label="Model tier">
      {NEXTORE_TIERS.map((tier) => {
        const active = tier === value;
        return (
          <button
            key={tier}
            type="button"
            role="radio"
            aria-checked={active}
            className={'nextore-tier-option' + (active ? ' is-active' : '')}
            data-testid={'nextore-tier-' + tier}
            disabled={disabled}
            title={TIER_TITLES[tier]}
            onClick={() => onChange(tier)}
          >
            {TIER_LABELS[tier]}
          </button>
        );
      })}
    </div>
  );
}
