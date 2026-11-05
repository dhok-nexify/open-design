import { describe, expect, it } from 'vitest';

import {
  AGENT_DEFS,
  agentDefsForEdition,
  getAgentDefForEdition,
} from '../../src/runtimes/registry.js';
import { BYOK_OPENCODE_AGENT_ID } from '../../src/runtimes/byok-opencode.js';

describe('agent registry — edition filter', () => {
  it('keeps the full upstream registry', () => {
    const defs = agentDefsForEdition('upstream');
    expect(defs).toBe(AGENT_DEFS);
    expect(defs.length).toBeGreaterThan(1);
    expect(getAgentDefForEdition('upstream', 'claude')).not.toBeNull();
  });

  it('collapses the NexTore edition to the daemon-owned BYOK runtime', () => {
    const defs = agentDefsForEdition('nextore');
    expect(defs.map((def) => def.id)).toEqual([BYOK_OPENCODE_AGENT_ID]);
    expect(getAgentDefForEdition('nextore', BYOK_OPENCODE_AGENT_ID)).not.toBeNull();
    expect(getAgentDefForEdition('nextore', 'claude')).toBeNull();
    expect(getAgentDefForEdition('nextore', 'codex')).toBeNull();
    expect(getAgentDefForEdition('nextore', 'amr')).toBeNull();
  });
});
