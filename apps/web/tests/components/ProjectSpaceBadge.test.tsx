// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { I18nProvider } from '../../src/i18n';
import { ProjectSpaceBadge } from '../../src/components/ProjectSpaceBadge';

describe('ProjectSpaceBadge', () => {
  it.each([
    ['personal', 'Personal'],
    ['team', 'Team'],
    ['shared', 'Shared'],
  ] as const)('renders the %s capsule with the workspace name as context', (kind, label) => {
    render(
      <I18nProvider initial="en">
        <ProjectSpaceBadge badge={{ kind, workspaceName: 'Design Team' }} />
      </I18nProvider>,
    );

    expect(screen.getByText(label)).toBeTruthy();
    expect(screen.getByLabelText(label + ': Design Team')).toBeTruthy();
  });
});
