import { describe, expect, it, vi } from 'vitest';

import {
  applyFrameDenyHeaders,
  isEmbeddablePath,
} from '../src/nextore-frame-guard.js';

describe('isEmbeddablePath', () => {
  it('allows the paths the shell iframes', () => {
    expect(isEmbeddablePath('/artifacts/p1/index.html')).toBe(true);
    expect(isEmbeddablePath('/frames/device.html')).toBe(true);
    expect(isEmbeddablePath('/vendor/fonts@1.0.0/fonts.css')).toBe(true);
  });

  it('does not treat a lookalike prefix as embeddable', () => {
    expect(isEmbeddablePath('/artifactual')).toBe(false);
    expect(isEmbeddablePath('/')).toBe(false);
    expect(isEmbeddablePath('/api/projects')).toBe(false);
  });
});

describe('applyFrameDenyHeaders', () => {
  it('denies framing of the shell in the edition', () => {
    const target = { setHeader: vi.fn() };
    expect(applyFrameDenyHeaders('nextore', '/', target)).toBe(true);
    expect(target.setHeader).toHaveBeenCalledWith('Content-Security-Policy', "frame-ancestors 'none'");
    expect(target.setHeader).toHaveBeenCalledWith('X-Frame-Options', 'DENY');
  });

  it('leaves embeddable routes alone', () => {
    const target = { setHeader: vi.fn() };
    expect(applyFrameDenyHeaders('nextore', '/artifacts/p1/index.html', target)).toBe(false);
    expect(target.setHeader).not.toHaveBeenCalled();
  });

  it('does nothing upstream', () => {
    const target = { setHeader: vi.fn() };
    expect(applyFrameDenyHeaders('upstream', '/', target)).toBe(false);
    expect(target.setHeader).not.toHaveBeenCalled();
  });
});
