'use client';

import { useEffect, useState } from 'react';
import { Select, VisuallyHidden } from '@open-design/components';

export interface NextoreModelOption {
  modelKey: string;
  name: string;
  source: string;
  capabilities: string[];
}

const PRESETS: NextoreModelOption[] = [
  { modelKey: 'fast', name: 'Fast', source: 'preset', capabilities: [] },
  { modelKey: 'expert', name: 'Expert', source: 'preset', capabilities: [] },
];

/**
 * Platform-backed model picker for the NexTore edition (P12).
 *
 * A native select keeps keyboard, touch and screen-reader behavior without a
 * custom listbox. The daemon validates the selected key; this component never
 * edits credentials or endpoints.
 */
export function ModelSelect({
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange: (modelKey: string) => void;
  disabled?: boolean;
}) {
  const [models, setModels] = useState<NextoreModelOption[]>(PRESETS);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch('/api/designer/models', {
          signal: controller.signal,
          headers: { accept: 'application/json' },
        });
        if (!response.ok) return;
        const body = await response.json() as { models?: NextoreModelOption[] };
        if (Array.isArray(body.models) && body.models.length > 0) setModels(body.models);
      } catch {
        // Keep presets: a catalog outage must not block a run.
      }
    })();
    return () => controller.abort();
  }, []);

  const visible = models.some((model) => model.modelKey === value)
    ? models
    : [...models, {
        modelKey: value,
        name: value + ' (unavailable)',
        source: 'unknown',
        capabilities: [] as string[],
      }];

  const selectId = 'nextore-model-select';
  return (
    <span className="nextore-model-select">
      <VisuallyHidden>
        <label htmlFor={selectId}>Model</label>
      </VisuallyHidden>
      <Select
        id={selectId}
        name="modelKey"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        data-testid="nextore-model-select"
      >
        {visible.map((model) => (
          <option key={model.modelKey} value={model.modelKey}>
            {model.name}
          </option>
        ))}
      </Select>
    </span>
  );
}
