// @vitest-environment jsdom
/**
 * The Designer is opened from a plain-http LAN address, where
 * `navigator.clipboard` does not exist. The copy buttons must still work.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { copyText } from '../../src/nextore/clipboard';

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
});

function setClipboard(value: unknown) {
  Object.defineProperty(navigator, 'clipboard', { value, configurable: true });
}

describe('copyText', () => {
  it('uses the async clipboard when the origin is secure', async () => {
    const writeText = vi.fn(async () => {});
    setClipboard({ writeText });
    await expect(copyText('https://share.test/x')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('https://share.test/x');
  });

  it('falls back to selecting the input when there is no clipboard API', async () => {
    setClipboard(undefined);
    const exec = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { value: exec, configurable: true });
    const input = document.createElement('input');
    input.value = 'https://share.test/x';
    document.body.appendChild(input);
    await expect(copyText('https://share.test/x', input)).resolves.toBe(true);
    expect(exec).toHaveBeenCalledWith('copy');
    input.remove();
  });

  it('reports failure when neither path is available', async () => {
    setClipboard(undefined);
    await expect(copyText('https://share.test/x')).resolves.toBe(false);
  });
});
