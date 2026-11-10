import { describe, expect, it } from 'vitest';

import { isDesignerAccessRequiredBody } from '../../src/nextore/access-required';

describe('isDesignerAccessRequiredBody', () => {
  it('recognizes the daemon access-denial code', () => {
    expect(isDesignerAccessRequiredBody({
      error: { code: 'DESIGNER_ACCESS_REQUIRED', message: 'no access' },
    })).toBe(true);
  });

  it('ignores other 403 bodies', () => {
    expect(isDesignerAccessRequiredBody({ error: { code: 'PROJECT_FORBIDDEN' } })).toBe(false);
    expect(isDesignerAccessRequiredBody({ error: 'nope' })).toBe(false);
    expect(isDesignerAccessRequiredBody(null)).toBe(false);
    expect(isDesignerAccessRequiredBody('DESIGNER_ACCESS_REQUIRED')).toBe(false);
  });
});
