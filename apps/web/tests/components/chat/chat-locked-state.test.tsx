// @vitest-environment jsdom
/**
 * A read-only shared project has no transcript to fetch, so the chat column
 * must explain the permission boundary instead of showing a spinner forever.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';

import { ChatLockedState } from '../../../src/components/chat/ChatLockedState';
import { I18nProvider } from '../../../src/i18n';

afterEach(() => cleanup());

describe('ChatLockedState', () => {
  it('explains why the shared conversation is locked instead of loading', () => {
    const { getByTestId, getByRole, queryByRole } = render(
      <I18nProvider initial="zh-CN">
        <ChatLockedState />
      </I18nProvider>,
    );

    const pane = getByTestId('chat-locked-state');
    expect(getByRole('heading').textContent).toBe('共享项目中的对话已锁定');
    expect(pane.textContent).toContain('对话记录仅对项目成员可见');
    expect(pane.textContent).toContain('仍可查看内容和留下评论');
    // The old state announced itself as a status/busy region; this one is a
    // static explanation, so assistive tech must not keep saying "loading".
    expect(queryByRole('status')).toBeNull();
  });

  it('localizes the explanation', () => {
    const { getByRole } = render(
      <I18nProvider initial="en">
        <ChatLockedState />
      </I18nProvider>,
    );

    expect(getByRole('heading').textContent).toBe('Chat is locked in this shared project');
  });
});
