import { describe, expect, it } from 'vitest';

import { enterpriseUrl } from '../../src/components/enterpriseUrl';

describe('enterpriseUrl', () => {
  it('points the team marketing link at the Nexify site', () => {
    for (const locale of ['en', 'zh-CN', 'ja', 'pt-BR', 'zh-TW', 'pl', 'id', 'ar', 'uk']) {
      expect(enterpriseUrl(locale)).toBe('http://www.nexify.com.hk/');
    }
  });
});
