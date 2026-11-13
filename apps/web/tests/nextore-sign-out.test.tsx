// @vitest-environment jsdom
/**
 * The main site cannot sign the Designer out for us: logging out of NexTore
 * ends the browser's site session, while the Designer authenticates with an
 * OAuth connection that renews itself until it is revoked. These tests pin the
 * in-app replacement — an explicit sign-out, a tab that stays signed out, and
 * an honest failure when the daemon refuses.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { I18nProvider } from '../src/i18n';
import { DesignerSignedOut } from '../src/nextore/DesignerSignedOut';
import { NextoreAccountActions } from '../src/nextore/AccountActions';
import type { NextoreAccountActionsProps } from '../src/nextore/AccountActions';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  window.sessionStorage.clear();
});

function loadEditionSignOut() {
  vi.stubEnv('NEXT_PUBLIC_OD_EDITION', 'nextore');
  vi.resetModules();
  return import('../src/nextore/sign-out');
}

describe('sign-out flow', () => {
  it('keeps the sign-in return path same-origin', async () => {
    const { signInUrl } = await loadEditionSignOut();

    expect(signInUrl('/projects/p1')).toBe('/auth/start?return=%2Fprojects%2Fp1');
    // A protocol-relative value would send the browser to another host.
    expect(signInUrl('//evil.test')).toBe('/auth/start?return=%2F');
  });

  it('ends the session and holds this tab out of the automatic sign-in', async () => {
    const { isSignedOut, signOutOfDesigner } = await loadEditionSignOut();
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));

    expect(await signOutOfDesigner(fetchMock as unknown as typeof fetch)).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith('/auth/logout', { method: 'POST' });
    expect(isSignedOut()).toBe(true);
  });

  it('does not claim a signed-out tab when the daemon refuses', async () => {
    const { isSignedOut, signOutOfDesigner } = await loadEditionSignOut();
    const fetchMock = vi.fn(async () => new Response(null, { status: 500 }));

    expect(await signOutOfDesigner(fetchMock as unknown as typeof fetch)).toBe(false);
    expect(isSignedOut()).toBe(false);
  });
});

function renderActions(props: NextoreAccountActionsProps) {
  return render(
    <I18nProvider initial="zh-CN">
      <NextoreAccountActions {...props} />
    </I18nProvider>,
  );
}

describe('NextoreAccountActions', () => {
  it('offers sign-out and account switching, and ends the session on click', async () => {
    const onSignOut = vi.fn(async () => true);
    const onNavigate = vi.fn();
    renderActions({ onSignOut, onNavigate });

    fireEvent.click(screen.getByRole('menuitem', { name: /退出本机登录/ }));

    await waitFor(() => expect(onSignOut).toHaveBeenCalledTimes(1));
    expect(onNavigate).toHaveBeenCalledWith('/');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says so when the session could not be ended', async () => {
    const onNavigate = vi.fn();
    renderActions({ onSignOut: async () => false, onNavigate });

    fireEvent.click(screen.getByRole('menuitem', { name: /退出本机登录/ }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('switches account through the OAuth entry point without ending this session first', () => {
    const onNavigate = vi.fn();
    const onSignOut = vi.fn(async () => true);
    renderActions({ onNavigate, onSignOut });

    fireEvent.click(screen.getByRole('menuitem', { name: /切换 NexTore 账号/ }));

    expect(onNavigate).toHaveBeenCalledWith('/auth/start?return=%2F');
    expect(onSignOut).not.toHaveBeenCalled();
  });
});

describe('DesignerSignedOut', () => {
  it('explains the ended session and offers one way back in', () => {
    const onSignIn = vi.fn();
    render(
      <I18nProvider initial="zh-CN">
        <DesignerSignedOut onSignIn={onSignIn} />
      </I18nProvider>,
    );

    const page = screen.getByTestId('designer-signed-out');
    expect(page.textContent).toContain('已退出 Designer');
    expect(page.textContent).toContain('不会让你退出 NexTore 主站');

    fireEvent.click(screen.getByRole('button', { name: /重新登录/ }));
    expect(onSignIn).toHaveBeenCalledTimes(1);
  });
});
