import { describe, expect, it } from 'vitest';

import { editionAgentGate } from '../../src/edition/agent-selection.js';
import { BYOK_OPENCODE_AGENT_ID } from '../../src/runtimes/byok-opencode.js';

describe('editionAgentGate', () => {
  it('leaves upstream selection untouched', () => {
    expect(editionAgentGate('upstream', 'claude')).toBeNull();
    expect(editionAgentGate('upstream', null)).toBeNull();
  });

  it('forces the single edition runtime', () => {
    expect(editionAgentGate('nextore', null)).toEqual({ agentId: BYOK_OPENCODE_AGENT_ID });
    expect(editionAgentGate('nextore', '')).toEqual({ agentId: BYOK_OPENCODE_AGENT_ID });
    expect(editionAgentGate('nextore', '  ')).toEqual({ agentId: BYOK_OPENCODE_AGENT_ID });
    expect(editionAgentGate('nextore', BYOK_OPENCODE_AGENT_ID)).toEqual({
      agentId: BYOK_OPENCODE_AGENT_ID,
    });
  });

  it('rejects a runtime the edition does not ship instead of downgrading', () => {
    expect(editionAgentGate('nextore', 'claude')).toEqual({ reject: 'claude' });
    expect(editionAgentGate('nextore', 'codex')).toEqual({ reject: 'codex' });
    expect(editionAgentGate('nextore', ' claude ')).toEqual({ reject: 'claude' });
  });
});
