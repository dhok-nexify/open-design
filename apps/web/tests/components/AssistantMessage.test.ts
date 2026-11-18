import { describe, expect, it } from 'vitest';
import { assistantRoleLabel, assistantRoleName } from '../../src/components/AssistantMessage';
import type { ChatMessage } from '../../src/types';

const t = () => 'Assistant';

describe('assistantRoleName', () => {
  it('uses the product brand for the byok-opencode bridge in the NexTore edition', () => {
    const message: ChatMessage = {
      id: 'message-brand',
      role: 'assistant',
      content: '',
      agentId: 'byok-opencode',
    };

    expect(assistantRoleName(message, t, {
      edition: 'nextore',
      brandName: 'Nextore Designer',
    })).toBe('Nextore Designer');
  });

  it('keeps the upstream OpenCode label outside the NexTore edition', () => {
    const message: ChatMessage = {
      id: 'message-upstream',
      role: 'assistant',
      content: '',
      agentId: 'byok-opencode',
    };

    expect(assistantRoleName(message, t, {
      edition: 'upstream',
      brandName: 'Nextore Designer',
    })).toBe('OpenCode');
  });

  it('keeps the real OpenCode CLI label in the NexTore edition', () => {
    const message: ChatMessage = {
      id: 'message-opencode',
      role: 'assistant',
      content: '',
      agentId: 'opencode',
    };

    expect(assistantRoleName(message, t, {
      edition: 'nextore',
      brandName: 'Nextore Designer',
    })).toBe('OpenCode');
  });
});

describe('assistantRoleLabel', () => {
  it('prefers the persisted assistant display name over the protocol id', () => {
    const message: ChatMessage = {
      id: 'message-1',
      role: 'assistant',
      content: '',
      agentId: 'openai-api',
      agentName: 'OpenAI API via OpenCode · google/gemma-4-e4b',
    };

    expect(assistantRoleLabel(message, t)).toBe('OpenAI API via OpenCode · google/gemma-4-e4b');
  });

  it('maps API protocol ids to readable labels when no display name is saved', () => {
    const message: ChatMessage = {
      id: 'message-2',
      role: 'assistant',
      content: '',
      agentId: 'openai-api',
    };

    expect(assistantRoleLabel(message, t)).toBe('OpenAI API via OpenCode');
  });

  it('maps OpenCode-backed BYOK protocol ids to readable labels', () => {
    const message: ChatMessage = {
      id: 'message-senseaudio',
      role: 'assistant',
      content: '',
      agentId: 'senseaudio-api',
    };

    expect(assistantRoleLabel(message, t)).toBe('SenseAudio API via OpenCode');
  });

  it('normalizes saved API protocol ids used as display names', () => {
    const message: ChatMessage = {
      id: 'message-3',
      role: 'assistant',
      content: '',
      agentName: 'openai-api',
    };

    expect(assistantRoleLabel(message, t)).toBe('OpenAI API via OpenCode');
  });

  it('preserves an explicit local agent model in the display name', () => {
    const message: ChatMessage = {
      id: 'message-4',
      role: 'assistant',
      content: '',
      agentId: 'claude',
      agentName: 'Claude · claude-sonnet-4-6',
    };

    expect(assistantRoleLabel(message, t)).toBe('Claude · claude-sonnet-4-6');
  });

  it('adds the model reported by a local CLI initializing event', () => {
    const message: ChatMessage = {
      id: 'message-5',
      role: 'assistant',
      content: '',
      agentId: 'claude',
      agentName: 'Claude',
      events: [{ kind: 'status', label: 'initializing', detail: 'claude-sonnet-4-6' }],
    };

    expect(assistantRoleLabel(message, t)).toBe('Claude · claude-sonnet-4-6');
  });
});
