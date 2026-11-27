// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { ModelSelect } from '../src/nextore/ModelSelect';
import {
  readStoredNextoreModelKey,
  readStoredNextoreModelKeyForProject,
  writeStoredNextoreModelKeyForProject,
} from '../src/nextore/model';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ModelSelect', () => {
  it('uses a labeled native select and offers platform models', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        models: [
          { modelKey: 'fast', name: 'Fast', source: 'preset', capabilities: [] },
          { modelKey: 'expert', name: 'Expert', source: 'preset', capabilities: [] },
          { modelKey: 'model:42', name: '42', source: 'custom', capabilities: ['tools'] },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const onChange = vi.fn();

    render(<ModelSelect value="expert" onChange={onChange} />);
    const select = screen.getByLabelText('Model');
    expect(select.tagName).toBe('SELECT');

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/designer/models',
      expect.objectContaining({ headers: { accept: 'application/json' } }),
    ));
    expect(screen.getByRole('option', { name: '42' })).toBeTruthy();

    fireEvent.change(select, { target: { value: 'model:42' } });
    expect(onChange).toHaveBeenCalledWith('model:42');
  });
});

describe('nextore model preference', () => {
  it('migrates the legacy tier key once and treats the model key as authoritative', () => {
    const values = new Map<string, string>([
      ['open-design:nextore-tier:project-1', 'fast'],
    ]);
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    };

    expect(readStoredNextoreModelKeyForProject('project-1', storage)).toBe('fast');
    expect(values.get('open-design:nextore-model:project-1')).toBe('fast');

    writeStoredNextoreModelKeyForProject('project-1', 'model:42', storage);
    expect(readStoredNextoreModelKeyForProject('project-1', storage)).toBe('model:42');
  });

  it('migrates the global legacy tier without overriding a saved model', () => {
    const values = new Map<string, string>([
      ['open-design:nextore-tier', 'fast'],
    ]);
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: () => undefined,
    };
    expect(readStoredNextoreModelKey(storage)).toBe('fast');

    values.set('open-design:nextore-model', 'model:7');
    expect(readStoredNextoreModelKey(storage)).toBe('model:7');
  });
});
