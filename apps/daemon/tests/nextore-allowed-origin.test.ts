import { describe, expect, it } from 'vitest';

import { addDesignerOrigin } from '../src/nextore-allowed-origin.js';
import { isAllowedBrowserOrigin } from '../src/origin-validation.js';

describe('addDesignerOrigin', () => {
  it('adds the configured Designer origin in the edition', () => {
    expect(addDesignerOrigin([], 'nextore', 'http://10.68.150.145:8888')).toEqual([
      'http://10.68.150.145:8888',
    ]);
  });

  it('normalises a trailing slash and does not duplicate', () => {
    expect(
      addDesignerOrigin(['http://a.test:8888'], 'nextore', 'http://a.test:8888/'),
    ).toEqual(['http://a.test:8888']);
    expect(addDesignerOrigin([], 'nextore', 'http://a.test:8888/')).toEqual(['http://a.test:8888']);
  });

  it('does nothing upstream or without a configured URL', () => {
    expect(addDesignerOrigin(['x'], 'upstream', 'http://a.test')).toEqual(['x']);
    expect(addDesignerOrigin(['x'], 'nextore', null)).toEqual(['x']);
    expect(addDesignerOrigin(['x'], 'nextore', '   ')).toEqual(['x']);
  });

  it('makes a reverse-proxied same-origin POST acceptable', () => {
    // The daemon itself listens on 7456; the browser reaches the page on 8888.
    const origins = addDesignerOrigin([], 'nextore', 'http://10.68.150.145:8888');
    expect(
      isAllowedBrowserOrigin(
        'http://10.68.150.145:8888',
        '10.68.150.145:8888',
        [7456],
        '0.0.0.0',
        origins,
      ),
    ).toBe(true);
    expect(
      isAllowedBrowserOrigin(
        'http://10.68.150.145:8888',
        '10.68.150.145:8888',
        [7456],
        '0.0.0.0',
        [],
      ),
    ).toBe(false);
  });
});
