// @vitest-environment jsdom

import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { TierToggle } from '../src/nextore/TierToggle';
import type { NextoreTier } from '@open-design/contracts';

afterEach(cleanup);

function Harness({ initial = 'expert' as NextoreTier, disabled = false }) {
  const [tier, setTier] = useState<NextoreTier>(initial);
  return <TierToggle value={tier} onChange={setTier} disabled={disabled} />;
}

describe('TierToggle', () => {
  it('renders Fast and Expert with the active one checked', () => {
    render(<Harness />);
    expect(screen.getByTestId('nextore-tier-fast').getAttribute('aria-checked')).toBe('false');
    expect(screen.getByTestId('nextore-tier-expert').getAttribute('aria-checked')).toBe('true');
  });

  it('switches the selection on click', () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId('nextore-tier-fast'));
    expect(screen.getByTestId('nextore-tier-fast').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByTestId('nextore-tier-expert').getAttribute('aria-checked')).toBe('false');
  });

  it('does not change while disabled', () => {
    render(<Harness disabled />);
    expect(screen.getByTestId('nextore-tier-fast')).toHaveProperty('disabled', true);
  });
});
