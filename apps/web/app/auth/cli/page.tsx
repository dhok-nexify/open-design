'use client';

import { useCallback, useEffect, useState } from 'react';
import type { CSSProperties } from 'react';

/**
 * NXD-P10 CLI consent screen.
 *
 * The CLI opens this URL with a PKCE challenge and a loopback redirect. The page
 * never sees the verifier: it only asks the daemon for a one-time code and hands
 * that code to the loopback listener the CLI is already running. Approval needs
 * a real browser session, and a stolen code is useless without the verifier that
 * never left the terminal.
 */

type Phase = 'checking' | 'ready' | 'signed-out' | 'working' | 'invalid' | 'done' | 'error';

interface Params {
  state: string;
  challenge: string;
  redirect: string;
}

/** Only a loopback callback is accepted; anything else is a redirect attack. */
const LOOPBACK_REDIRECT = /^http:\/\/(?:127\.0\.0\.1|localhost):(\d{1,5})\/callback$/;
const CHALLENGE = /^[A-Za-z0-9_-]{43,128}$/;

function readParams(): Params | null {
  const search = new URLSearchParams(window.location.search);
  const state = (search.get('state') ?? '').trim();
  const challenge = (search.get('challenge') ?? '').trim();
  const redirect = (search.get('redirect') ?? '').trim();
  if (!state || state.length > 256) return null;
  if (!CHALLENGE.test(challenge)) return null;
  if (!LOOPBACK_REDIRECT.test(redirect)) return null;
  return { state, challenge, redirect };
}

function hostOf(redirect: string): string {
  try {
    return new URL(redirect).host;
  } catch {
    return redirect;
  }
}

const pageStyle: CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '24px',
  background: '#f4f6f8',
  color: '#1f2933',
};

const cardStyle: CSSProperties = {
  width: 'min(520px, 100%)',
  background: '#ffffff',
  border: '1px solid #e4e7eb',
  borderRadius: '14px',
  padding: '32px',
  boxShadow: '0 1px 2px rgba(16,24,40,0.04), 0 12px 32px rgba(16,24,40,0.06)',
};

const eyebrowStyle: CSSProperties = {
  fontSize: '11px',
  letterSpacing: '0.09em',
  textTransform: 'uppercase',
  color: '#7b8794',
  marginBottom: '10px',
};

const titleStyle: CSSProperties = { margin: '0 0 12px', fontSize: '22px', lineHeight: 1.3, fontWeight: 600 };
const bodyStyle: CSSProperties = { margin: '0 0 8px', fontSize: '15px', lineHeight: 1.65, color: '#3e4c59' };
const hintStyle: CSSProperties = { margin: '16px 0 0', fontSize: '13px', lineHeight: 1.6, color: '#7b8794' };
const actionsStyle: CSSProperties = { marginTop: '26px', display: 'flex', gap: '10px', alignItems: 'center' };

export default function CliAuthorizePage() {
  const [phase, setPhase] = useState<Phase>('checking');
  const [params, setParams] = useState<Params | null>(null);
  const [memberName, setMemberName] = useState('');
  const [siteTitle, setSiteTitle] = useState('NexTore Designer');
  const [accent, setAccent] = useState('#0e4656');
  const [message, setMessage] = useState('');

  useEffect(() => {
    const parsed = readParams();
    if (!parsed) {
      setPhase('invalid');
      setMessage('This authorization link is incomplete, or it points somewhere other than this computer.');
      return;
    }
    setParams(parsed);

    void fetch('/api/branding', { headers: { accept: 'application/json' } })
      .then((response) => (response.ok ? response.json() : null))
      .then((brand: { siteTitle?: unknown; primaryColor?: unknown } | null) => {
        if (brand && typeof brand.siteTitle === 'string' && brand.siteTitle.trim()) {
          setSiteTitle(brand.siteTitle.trim());
        }
        if (brand && typeof brand.primaryColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(brand.primaryColor)) {
          setAccent(brand.primaryColor);
        }
      })
      .catch(() => {});

    void fetch('/auth/me', { headers: { accept: 'application/json' } })
      .then(async (response) => {
        if (response.status === 401) {
          setPhase('signed-out');
          return;
        }
        if (!response.ok) {
          setPhase('error');
          setMessage('The Designer daemon could not confirm your session.');
          return;
        }
        const body = (await response.json()) as { member?: { fullName?: unknown; login?: unknown } };
        const name = body.member?.fullName ?? body.member?.login;
        setMemberName(typeof name === 'string' ? name : '');
        setPhase('ready');
      })
      .catch(() => {
        setPhase('error');
        setMessage('The Designer daemon is unreachable.');
      });
  }, []);

  const authorize = useCallback(async () => {
    if (!params) return;
    setPhase('working');
    setMessage('');
    try {
      const response = await fetch('/api/auth/cli/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ state: params.state, challenge: params.challenge }),
      });
      const body = (await response.json().catch(() => null)) as
        { code?: unknown; error?: unknown; message?: unknown } | null;
      if (!response.ok || !body || typeof body.code !== 'string') {
        const detail = typeof body?.message === 'string'
          ? body.message
          : (typeof body?.error === 'string' ? body.error : '');
        throw new Error(detail || 'The daemon refused to issue an authorization code.');
      }
      setPhase('done');
      window.location.replace(
        params.redirect
          + '?code=' + encodeURIComponent(body.code)
          + '&state=' + encodeURIComponent(params.state),
      );
    } catch (error) {
      setPhase('error');
      setMessage(error instanceof Error ? error.message : 'Authorization failed.');
    }
  }, [params]);

  const primary: CSSProperties = {
    background: accent,
    color: '#ffffff',
    border: 'none',
    borderRadius: '8px',
    padding: '11px 20px',
    fontSize: '15px',
    fontWeight: 600,
    cursor: phase === 'working' ? 'progress' : 'pointer',
    textDecoration: 'none',
    display: 'inline-block',
  };
  const secondary: CSSProperties = {
    background: 'transparent',
    color: '#52606d',
    border: '1px solid #d9dee4',
    borderRadius: '8px',
    padding: '11px 18px',
    fontSize: '15px',
    textDecoration: 'none',
    display: 'inline-block',
  };

  return (
    <main style={pageStyle}>
      <section style={cardStyle} aria-labelledby="cli-authorize-title">
        <div style={eyebrowStyle}>{siteTitle}</div>
        <h1 id="cli-authorize-title" style={titleStyle}>Authorize the command line</h1>

        {phase === 'checking' && <p style={bodyStyle}>Checking your session…</p>}

        {phase === 'invalid' && <p style={bodyStyle} role="alert">{message}</p>}

        {phase === 'signed-out' && (
          <>
            <p style={bodyStyle}>
              Sign in to {siteTitle} first, then open the link the terminal printed again.
            </p>
            <div style={actionsStyle}>
              <a href="/" style={primary}>Go to sign in</a>
            </div>
          </>
        )}

        {(phase === 'ready' || phase === 'working') && params && (
          <>
            <p style={bodyStyle}>
              The <strong>od</strong> command line tool is asking to act as
              {memberName ? <strong> {memberName}</strong> : ' you'}. It will be able to read and
              update your projects and start runs. It cannot change site settings, members, or
              permissions.
            </p>
            <p style={hintStyle}>
              The authorization code is returned only to {hostOf(params.redirect)} on this computer.
            </p>
            <div style={actionsStyle}>
              <button
                type="button"
                style={primary}
                onClick={() => void authorize()}
                disabled={phase === 'working'}
              >
                {phase === 'working' ? 'Authorizing…' : 'Authorize'}
              </button>
              <a href="/" style={secondary}>Cancel</a>
            </div>
          </>
        )}

        {phase === 'done' && <p style={bodyStyle}>Authorized. You can return to the terminal.</p>}

        {phase === 'error' && (
          <>
            <p style={bodyStyle} role="alert">{message}</p>
            <div style={actionsStyle}>
              <a href="/" style={secondary}>Close</a>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
