// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  SKETCH_ENGINE_WARM_KEY,
  markSketchEngineUsed,
  shouldPrewarmSketchEngine,
} from '../../src/components/sketch-engine-warm';

function setConnection(connection: { saveData?: boolean; effectiveType?: string } | undefined) {
  Object.defineProperty(navigator, 'connection', {
    configurable: true,
    value: connection,
  });
}

describe('sketch engine prewarm gating', () => {
  beforeEach(() => {
    window.localStorage.clear();
    setConnection(undefined);
  });

  it('stays off until the browser has opened a sketch', () => {
    expect(shouldPrewarmSketchEngine()).toBe(false);
    markSketchEngineUsed();
    expect(window.localStorage.getItem(SKETCH_ENGINE_WARM_KEY)).toBe('1');
    expect(shouldPrewarmSketchEngine()).toBe(true);
  });

  it('respects data saver and slow connection classes', () => {
    markSketchEngineUsed();
    setConnection({ saveData: true });
    expect(shouldPrewarmSketchEngine()).toBe(false);

    setConnection({ effectiveType: '3g' });
    expect(shouldPrewarmSketchEngine()).toBe(false);

    setConnection({ effectiveType: '4g' });
    expect(shouldPrewarmSketchEngine()).toBe(true);
  });
});
