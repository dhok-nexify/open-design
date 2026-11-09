import { afterEach, describe, expect, it } from 'vitest';

import { setBrandName } from '../src/i18n';
import { localizeSkillDescription } from '../src/i18n/content';

afterEach(() => setBrandName(null));

describe('skill description brand interpolation', () => {
  it('interpolates {brandName} on the fallback description path', () => {
    setBrandName('NexTore Designer');
    const description = localizeSkillDescription('en', {
      id: 'local-test-skill',
      name: 'Local test skill',
      description: 'Read the selected {brandName} browser tab.',
    } as never);
    expect(description).toBe('Read the selected NexTore Designer browser tab.');
  });
});
