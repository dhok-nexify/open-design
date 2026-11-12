import { describe, expect, it, vi } from 'vitest';

import {
  applyFrameDenyHeaders,
  applySameOriginPreviewFrameHeaders,
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

describe('applySameOriginPreviewFrameHeaders', () => {
  it('allows only the shell origin to frame raw previews', () => {
    const target = { setHeader: vi.fn(), getHeader: vi.fn(), removeHeader: vi.fn() };
    expect(applySameOriginPreviewFrameHeaders('nextore', target)).toBe(true);
    expect(target.setHeader).toHaveBeenCalledWith(
      'Content-Security-Policy',
      "connect-src 'none'; frame-ancestors 'self'",
    );
    expect(target.removeHeader).toHaveBeenCalledWith('X-Frame-Options');
  });

  it('preserves the route handler CSP instead of dropping connect-src', () => {
    const target = {
      setHeader: vi.fn(),
      getHeader: vi.fn(() => "sandbox allow-scripts; default-src 'self'; connect-src 'none'; frame-ancestors 'none'"),
      removeHeader: vi.fn(),
    };
    expect(applySameOriginPreviewFrameHeaders('nextore', target)).toBe(true);
    expect(target.setHeader).toHaveBeenCalledWith(
      'Content-Security-Policy',
      "sandbox allow-scripts; default-src 'self'; connect-src 'none'; frame-ancestors 'self'",
    );
  });

  it('adds connect-src isolation when the existing CSP omits it', () => {
    const target = {
      setHeader: vi.fn(),
      getHeader: vi.fn(() => "default-src 'self'"),
      removeHeader: vi.fn(),
    };
    applySameOriginPreviewFrameHeaders('nextore', target);
    expect(target.setHeader).toHaveBeenCalledWith(
      'Content-Security-Policy',
      "default-src 'self'; connect-src 'none'; frame-ancestors 'self'",
    );
  });

  it('does nothing upstream', () => {
    const target = { setHeader: vi.fn(), getHeader: vi.fn(), removeHeader: vi.fn() };
    expect(applySameOriginPreviewFrameHeaders('upstream', target)).toBe(false);
    expect(target.setHeader).not.toHaveBeenCalled();
  });
});
