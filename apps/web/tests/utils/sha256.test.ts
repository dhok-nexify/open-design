import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { sha256Hex } from '../../src/utils/sha256';

function nodeDigest(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

describe('sha256Hex', () => {
  it.each([
    '',
    'abc',
    '你好 NexTore Designer',
    'A'.repeat(55),
    'A'.repeat(56),
    'A'.repeat(64),
    'A'.repeat(1_000),
    'line one\nline two\n',
  ])('matches Node SHA-256 for %j', (value) => {
    expect(sha256Hex(new TextEncoder().encode(value))).toBe(nodeDigest(value));
  });

  it('hashes raw bytes without mutating the input', () => {
    const bytes = new Uint8Array([0, 1, 2, 127, 128, 255]);
    const before = [...bytes];
    expect(sha256Hex(bytes)).toBe(nodeDigest(bytes));
    expect([...bytes]).toEqual(before);
  });
});
