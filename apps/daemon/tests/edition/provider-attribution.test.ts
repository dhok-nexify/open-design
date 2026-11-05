import { describe, expect, it } from 'vitest';

import { attributionHeadersForEdition } from '../../src/edition/provider-attribution.js';

describe('attributionHeadersForEdition', () => {
  it('keeps the upstream attribution headers', () => {
    expect(attributionHeadersForEdition('upstream')).toEqual({
      'HTTP-Referer': 'https://opendesign.dev',
      'X-Title': 'OpenDesign',
    });
  });

  it('sends no attribution in the NexTore edition', () => {
    expect(attributionHeadersForEdition('nextore')).toEqual({});
  });
});
