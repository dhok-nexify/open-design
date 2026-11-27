import { createHash } from 'node:crypto';
import type { Express, NextFunction, Request, RequestHandler, Response } from 'express';
import { NextoreClientError, type NextoreClient } from '../client.js';
import type { NextoreConfig } from '../config.js';
import {
  callbackUrl,
  exchangeAuthorizationCode,
  isPermanentTokenFailure,
  NextoreOAuthError,
  refreshAccessToken,
  type TokenSet,
} from './oauth.js';
import {
  base64Url,
  randomToken,
  safeEqual,
  signPayload,
  verifyPayload,
  type NextoreSecrets,
} from './secrets.js';
import type {
  NextoreSession,
  NextoreSessionFeatures,
  NextoreSessionMember,
  NextoreSessionRights,
  NextoreSessionStore,
  NextoreSessionGroup,
} from './session-store.js';
import {
  publishSessionRevoked,
  subscribeSessionEvents,
  subscribedSessionIds,
} from './session-events.js';

export const PENDING_COOKIE = 'nxd_oauth';
export const SESSION_COOKIE = 'nxd_session';

/** How long a half-finished sign-in may stay in the browser. */
const PENDING_TTL_MS = 10 * 60 * 1000;

/** Sliding session lifetime. The NexTore connection itself outlives it. */
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

/**
 * Absolute session lifetime, counted from sign-in instead of from the last
 * request.
 *
 * The sliding window above never closes for a tab that keeps getting used, and
 * the OAuth credential behind it renews itself until an administrator revokes
 * the connection. So signing out of NexTore — or signing in there as somebody
 * else — leaves this Designer session live indefinitely without this cap. One
 * re-authentication per workday is the price of that boundary.
 */
const SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1000;

/** Re-check rights and revocation this often, per session. */
const REVALIDATE_MS = 5 * 60 * 1000;

/**
 * A tighter freshness budget for state-changing calls. Revoking a right,
 * disabling a member or deleting a profile has to stop a mutation inside a
 * minute; a read may still ride the five-minute window.
 */
const MUTATION_REVALIDATE_MS = 60 * 1000;

/**
 * The shortest gap between two *forced* validations.
 *
 * A foreground tab asks for one every time it becomes visible again, and a
 * person alt-tabbing repeatedly must not turn that into a bootstrap stream.
 * Nine seconds is short enough that a sign-out at the site is observed before
 * the person can do anything in this tab, and long enough that a burst of
 * focus events collapses into one check. It stays just under the shell's
 * ten-second foreground watchdog, so a probe is never skipped for being early.
 */
const FORCED_VALIDATE_FLOOR_MS = 9 * 1000;

/**
 * How often a session with an open event stream is validated.
 *
 * Only subscribed sessions are watched, so the cost is one module call per
 * session per interval — never one per tab, and none for a member with no
 * Designer tab open. The site's sign-out hint normally answers first; this is
 * the fallback for when it cannot reach the daemon.
 */
const WATCHDOG_INTERVAL_MS = 15 * 1000;

/**
 * Sign-out hints accepted per source address per minute.
 *
 * Generous on purpose: behind a reverse proxy every hint shares one address,
 * and an end-of-day wave of sign-outs must not start rejecting hints. The
 * limit exists to stop a caller using the daemon as a bootstrap amplifier,
 * not to ration a real sign-out.
 */
const HINT_LIMIT = 600;
const HINT_WINDOW_MS = 60 * 1000;

/** Keep-alive comment cadence for an idle event stream. */
const STREAM_KEEPALIVE_MS = 25 * 1000;

/**
 * How old a session may get before the shell is asked to re-run the OAuth
 * handshake silently.
 *
 * A sign-out at the site cannot reach this daemon, and the browser will not
 * hand the site's session cookie to a cross-site subresource, so no fetch can
 * detect one either. A top-level navigation to /auth/start does carry it: with
 * a live site session and a trusted client the site answers with a code and no
 * consent page, and the callback replaces this session row. Re-running the
 * handshake on a schedule is therefore the only way an account switch at the
 * site takes effect here without a platform change. See DESIGN §14.3.1.
 */
const SILENT_REAUTH_AFTER_MS = 60 * 60 * 1000;

/** Refresh the access token this long before it expires. */
const REFRESH_LEAD_MS = 60 * 1000;

/** Re-issue the sliding cookie at most once an hour. */
const SESSION_COOKIE_REFRESH_MS = 60 * 60 * 1000;

/** Persist last_seen_at at most once a minute instead of on every API call. */
const TOUCH_INTERVAL_MS = 60 * 1000;

/** Everything an unauthenticated browser may still reach. */
const PUBLIC_API_PATHS = new Set(['/health', '/ready', '/version', '/branding', '/auth/cli/token']);
const PUBLIC_API_SELF_TEST = '/nextore/self-test';
/** Share links are opened by recipients who have no Designer session at all. */
const PUBLIC_API_PREFIXES = ['/public-share/'];

/**
 * Client-supplied workspace identity is an upstream capability that has no
 * authority in this edition. Every one of these headers is dropped and the
 * authenticated member becomes the only identity a route can observe.
 */
const IDENTITY_HEADERS = [
  'x-od-app-user-id',
  'x-od-workspace-id',
  'x-od-workspace-type',
  'x-od-workspace-member-id',
  'x-od-workspace-role',
  'x-od-workspace-lifecycle-state',
  'x-od-workspace-member-status',
  'x-od-workspace-write-enabled',
  'x-od-workspace-can-share-projects',
  'x-od-workspace-can-write-synced-files',
] as const;

interface PendingSignIn {
  state: string;
  verifier: string;
  returnTo: string;
  /** Share-link token carried through SSO, when this sign-in started at /s/<token>. */
  share?: string;
  issuedAt: number;
}

interface SessionCookie {
  sid: string;
  issuedAt: number;
}

interface BootstrapMember {
  id?: unknown;
  Id?: unknown;
  login?: unknown;
  Login?: unknown;
  fullName?: unknown;
  FullName?: unknown;
  email?: unknown;
  Email?: unknown;
  language?: unknown;
  Language?: unknown;
  profileObjectId?: unknown;
  ProfileObjectId?: unknown;
}

interface BootstrapFeatures {
  memory?: unknown;
  Memory?: unknown;
  mcp?: unknown;
  Mcp?: unknown;
  shareLinks?: unknown;
  ShareLinks?: unknown;
}

interface BootstrapRights {
  access?: unknown;
  Access?: unknown;
  createProject?: unknown;
  CreateProject?: unknown;
  admin?: unknown;
  Admin?: unknown;
  manageMcp?: unknown;
  ManageMcp?: unknown;
}

interface BootstrapGroup {
  id?: unknown;
  Id?: unknown;
  name?: unknown;
  Name?: unknown;
}

interface BootstrapPayload {
  member?: BootstrapMember;
  Member?: BootstrapMember;
  groups?: BootstrapGroup[];
  Groups?: BootstrapGroup[];
  features?: BootstrapFeatures;
  Features?: BootstrapFeatures;
  rights?: BootstrapRights;
  Rights?: BootstrapRights;
}

function optionalFlag(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/**
 * The module's global feature switches ride on bootstrap. Missing fields keep
 * the module defaults (all enabled) so an older module build still works.
 */
function featuresFrom(payload: BootstrapPayload): NextoreSessionFeatures {
  const features = payload.features ?? payload.Features;
  return {
    memory: optionalFlag(features?.memory ?? features?.Memory, true),
    mcp: optionalFlag(features?.mcp ?? features?.Mcp, true),
    shareLinks: optionalFlag(features?.shareLinks ?? features?.ShareLinks, true),
  };
}

/**
 * Effective DesignProject rights. Security-sensitive, so every missing or
 * non-boolean value is false rather than the module default.
 */
function rightsFrom(payload: BootstrapPayload): NextoreSessionRights {
  const rights = payload.rights ?? payload.Rights;
  return {
    access: rights?.access === true || rights?.Access === true,
    createProject:
      rights?.createProject === true || rights?.CreateProject === true,
    admin: rights?.admin === true || rights?.Admin === true,
    manageMcp: rights?.manageMcp === true || rights?.ManageMcp === true,
  };
}

export interface NextoreAuthOptions {
  config: NextoreConfig;
  client: NextoreClient;
  store: NextoreSessionStore;
  secrets: () => NextoreSecrets;
  now?: () => number;
  /**
   * Delays for the re-checks after a sign-out hint whose earlier answer was
   * still valid. The module's revocation sweep rides the same platform event
   * as the hint, and its duration grows with the member's connection count,
   * so one fixed retry is not enough for an account with many.
   */
  hintRetryDelaysMs?: readonly number[];
  /**
   * Run-scoped tool requests authenticate with a signed tool token instead of
   * a browser session. Returning true lets that one request through.
   */
  allowRequest?: (req: Request) => boolean;
  /**
   * The browser session was replaced by a fresh one for the same member (the
   * cookie is re-issued on every OAuth round trip). Anything bound to the old
   * sid - a CLI token, for instance - has to follow it.
   */
  onSessionRotated?: (input: { previousSid: string; sid: string; memberId: number }) => void;
  /** A successful sign-in restores the credential used by pending publication. */
  onSessionEstablished?: ((input: { sid: string; memberId: number }) => void) | undefined;
}

export interface NextoreAuth {
  /** Mounts /auth/start, /auth/callback, /auth/logout and /auth/me. */
  registerRoutes(app: Express): void;
  /**
   * Requires a NexTore session on /api and generated-asset requests that are
   * not public. The self-test path resolves a session opportunistically and
   * records the outcome in res.locals instead of rejecting.
   */
  gate: RequestHandler;
}

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;

  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    const value = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return undefined;
}

function cookieAttributes(config: NextoreConfig): string {
  const secure = config.designerBaseUrl.startsWith('https://') ? '; Secure' : '';
  return `Path=/; HttpOnly; SameSite=Lax${secure}`;
}

function setCookie(res: Response, name: string, value: string, maxAgeMs: number, config: NextoreConfig): void {
  res.append(
    'Set-Cookie',
    `${name}=${encodeURIComponent(value)}; Max-Age=${Math.floor(maxAgeMs / 1000)}; ${cookieAttributes(config)}`,
  );
}

function clearCookie(res: Response, name: string, config: NextoreConfig): void {
  res.append('Set-Cookie', `${name}=; Max-Age=0; ${cookieAttributes(config)}`);
}

/** Methods that change nothing, so a slightly stale validation may serve them. */
function isSafeMethod(method: string | undefined): boolean {
  return method === 'GET' || method === 'HEAD' || method === 'OPTIONS';
}

/**
 * Browser traffic must come from this exact origin.
 *
 * A NexTore page on a different port is same-site, so SameSite=Lax alone does
 * not stop it from composing a request. The Origin header is browser-owned and
 * cannot be forged by page script. A request with no Origin is a non-browser
 * caller: safe methods may proceed to the session check, while state-changing
 * methods fail closed (the run-scoped tool lane is handled before this).
 */
function isAllowedDesignerOrigin(req: Request, config: NextoreConfig): boolean {
  const safeMethod = isSafeMethod(req.method);
  const origin = req.headers.origin;
  if (typeof origin !== 'string' || origin.length === 0) return safeMethod;
  // Sandboxed preview iframes send an opaque origin. Their GET requests still
  // need the session cookie, which Lax withholds from a genuinely cross-site
  // subresource, so reading is safe; a state change from them is not.
  if (origin === 'null') return safeMethod;
  try {
    return new URL(origin).origin === config.designerBaseUrl;
  } catch {
    return false;
  }
}

function stripClientIdentity(req: Request, memberId: number): void {
  for (const name of IDENTITY_HEADERS) delete req.headers[name];
  req.headers['x-od-app-user-id'] = String(memberId);

  // Browser navigations cannot carry headers, so upstream readers also accept
  // workspace authority from the query string. Remove it from the URL before
  // any route can parse it; in this edition the session is the only identity.
  const queryIndex = req.url.indexOf('?');
  if (queryIndex >= 0) {
    const params = new URLSearchParams(req.url.slice(queryIndex + 1));
    params.delete('workspaceId');
    params.delete('workspaceMemberId');
    const query = params.toString();
    req.url = req.url.slice(0, queryIndex) + (query ? `?${query}` : '');
  }
  const parsedQuery = req.query as Record<string, unknown> | undefined;
  if (parsedQuery && typeof parsedQuery === 'object') {
    delete parsedQuery.workspaceId;
    delete parsedQuery.workspaceMemberId;
  }
}

/**
 * Only a path on this origin may be returned to. A protocol-relative URL
 * (`//evil.test`), a backslash that a browser would normalize into one, and
 * anything with control characters are refused, because the value arrives in a
 * query string a third party can compose.
 */
export function safeReturnTo(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return '/';
  if (value.includes('\\')) return '/';
  if (/[\u0000-\u001f\u007f]/.test(value)) return '/';

  try {
    const parsed = new URL(value, 'http://designer.invalid');
    if (parsed.origin !== 'http://designer.invalid') return '/';
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return '/';
  }
}

/**
 * A share token is opaque base64url produced by the daemon. Validate it before
 * it enters the signed pending cookie so the cookie cannot carry arbitrary text.
 */
function safeShareToken(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const token = value.trim();
  return /^[A-Za-z0-9_-]{32,128}$/.test(token) ? token : null;
}

function pkceChallenge(verifier: string): string {
  return base64Url(createHash('sha256').update(verifier, 'ascii').digest());
}

function textField(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function integerField(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Read the member from a bootstrap response.
 *
 * ASP.NET Core serializes the module's model with the web defaults, so the
 * wire shape is camelCase (`member.id`, not `Member.Id`). The PascalCase
 * alternates are kept as a cheap compatibility lane for older module builds;
 * the camelCase path is the one production uses.
 */
function memberFrom(payload: BootstrapPayload): NextoreSessionMember | null {
  const member = payload.member ?? payload.Member;
  if (!member) return null;

  const id = integerField(member.id ?? member.Id);
  if (id === null) return null;

  return {
    id,
    login: textField(member.login ?? member.Login),
    fullName: textField(member.fullName ?? member.FullName),
    email: textField(member.email ?? member.Email),
    language: textField(member.language ?? member.Language),
    profileObjectId: integerField(member.profileObjectId ?? member.ProfileObjectId) ?? 0,
    features: featuresFrom(payload),
    groups: groupsFrom(payload),
    rights: rightsFrom(payload),
  };
}

function groupsFrom(payload: BootstrapPayload): NextoreSessionGroup[] {
  const raw = payload.groups ?? payload.Groups;
  if (!Array.isArray(raw)) return [];
  const groups: NextoreSessionGroup[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const id = integerField(entry.id ?? entry.Id);
    if (id === null || groups.some((group) => group.id === id)) continue;
    groups.push({ id, name: textField(entry.name ?? entry.Name) });
  }
  return groups;
}

function errorPage(res: Response, message: string, status = 400): void {
  res
    .status(status)
    .type('html')
    .send(
      '<!doctype html><html><head><meta charset="utf-8"><title>Sign-in failed</title></head>' +
        '<body style="font-family:system-ui;max-width:32rem;margin:4rem auto;line-height:1.6">' +
        '<h1>Sign-in failed</h1><p>' + escapeHtml(message) + '</p>' +
        '<p><a href="/auth/start">Try again</a></p></body></html>',
    );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function createNextoreAuth(options: NextoreAuthOptions): NextoreAuth {
  const { config, client, store, secrets, allowRequest, onSessionRotated, onSessionEstablished } = options;
  const hintRetryDelaysMs = options.hintRetryDelaysMs ?? [2_000, 6_000];
  const now = options.now ?? (() => Date.now());

  type MemberResult =
    | { kind: 'ok'; member: NextoreSessionMember }
    | { kind: 'unauthorized' }
    | { kind: 'unavailable' };

  type RenewResult =
    | { kind: 'ok'; session: NextoreSession }
    | { kind: 'permanent' }
    | { kind: 'unavailable' };

  type ResolveResult =
    | { kind: 'ok'; session: NextoreSession; issuedAt: number }
    | { kind: 'signed_out' }
    | { kind: 'unavailable' };

  function readPendingSignIn(raw: string | undefined): PendingSignIn | null {
    if (!raw) return null;
    const value = verifyPayload<Partial<PendingSignIn>>(secrets(), raw);
    if (!value) return null;
    if (typeof value.state !== 'string' || !value.state) return null;
    if (typeof value.verifier !== 'string' || !value.verifier) return null;
    if (typeof value.issuedAt !== 'number' || !Number.isFinite(value.issuedAt)) return null;
    const share = safeShareToken(value.share);
    return {
      state: value.state,
      verifier: value.verifier,
      returnTo: safeReturnTo(value.returnTo),
      ...(share ? { share } : {}),
      issuedAt: value.issuedAt,
    };
  }

  function readSessionCookie(raw: string | undefined): SessionCookie | null {
    if (!raw) return null;
    const value = verifyPayload<Partial<SessionCookie>>(secrets(), raw);
    if (!value || typeof value.sid !== 'string' || !value.sid) return null;
    if (typeof value.issuedAt !== 'number' || !Number.isFinite(value.issuedAt)) return null;
    return { sid: value.sid, issuedAt: value.issuedAt };
  }

  function setSessionCookie(res: Response, sid: string, issuedAt: number): void {
    setCookie(
      res,
      SESSION_COOKIE,
      signPayload(secrets(), { sid, issuedAt } satisfies SessionCookie),
      SESSION_TTL_MS,
      config,
    );
  }

  function refreshSessionCookieIfStale(res: Response, issuedAt: number, sid: string): void {
    if (now() - issuedAt >= SESSION_COOKIE_REFRESH_MS) {
      setSessionCookie(res, sid, now());
    }
  }

  async function loadMemberOnce(accessToken: string): Promise<MemberResult> {
    try {
      const payload = await client.bootstrap<BootstrapPayload>(accessToken);
      const member = memberFrom(payload);
      if (!member) {
        return { kind: 'unavailable' };
      }
      return { kind: 'ok', member };
    } catch (error) {
      if (
        error instanceof NextoreClientError
        && error.code === 'nextore_http_error'
        && (error.statusCode === 401 || error.statusCode === 403)
      ) {
        return { kind: 'unauthorized' };
      }
      return { kind: 'unavailable' };
    }
  }

  const validations = new Map<string, Promise<MemberResult>>();

  function validate(session: NextoreSession): Promise<MemberResult> {
    const inFlight = validations.get(session.sid);
    if (inFlight) return inFlight;

    // Another request may have rotated the access token since this caller
    // loaded its row. Reading again turns that race into a successful check
    // instead of a second refresh against an already-replaced refresh token.
    const current = store.find(session.sid);
    if (!current) return Promise.resolve({ kind: 'unauthorized' });

    const pending = loadMemberOnce(current.accessToken);
    validations.set(session.sid, pending);
    const release = () => {
      if (validations.get(session.sid) === pending) validations.delete(session.sid);
    };
    void pending.then(release, release);
    return pending;
  }

  const refreshes = new Map<string, Promise<RenewResult>>();

  async function renewOnce(session: NextoreSession): Promise<RenewResult> {
    const current = store.find(session.sid);
    if (!current) return { kind: 'permanent' };

    if (current.accessToken !== session.accessToken) {
      // A concurrent request already completed the rotation.
      return { kind: 'ok', session: current };
    }

    if (!current.refreshToken) {
      store.remove(current.sid);
      return { kind: 'permanent' };
    }

    try {
      const tokens = await refreshAccessToken(config, current.refreshToken);
      const at = now();
      // RFC 6749 allows the server to omit refresh_token on renewal. Dropping
      // the old one in that case would leave the session unable to renew ever
      // again, so keep the existing credential unless a new one arrived.
      const refreshToken = tokens.refreshToken ?? current.refreshToken;
      store.updateTokens(current.sid, {
        accessToken: tokens.accessToken,
        refreshToken,
        tokenExpiresAt: tokens.expiresAt,
        validatedAt: at,
      });
      return {
        kind: 'ok',
        session: {
          ...current,
          accessToken: tokens.accessToken,
          refreshToken,
          tokenExpiresAt: tokens.expiresAt,
          lastSeenAt: at,
          lastValidatedAt: at,
        },
      };
    } catch (error) {
      if (isPermanentTokenFailure(error)) {
        store.remove(current.sid);
        return { kind: 'permanent' };
      }
      return { kind: 'unavailable' };
    }
  }

  function renew(session: NextoreSession): Promise<RenewResult> {
    const inFlight = refreshes.get(session.sid);
    if (inFlight) return inFlight;

    const pending = renewOnce(session);
    refreshes.set(session.sid, pending);
    const release = () => {
      if (refreshes.get(session.sid) === pending) refreshes.delete(session.sid);
    };
    void pending.then(release, release);
    return pending;
  }

  async function resolve(
    req: Request,
    options: { forceValidation?: boolean } = {},
  ): Promise<ResolveResult> {
    const cookie = readSessionCookie(readCookie(req, SESSION_COOKIE));
    if (!cookie) return { kind: 'signed_out' };

    let session = store.find(cookie.sid);
    if (!session) return { kind: 'signed_out' };

    const checkedAt = now();
    if (checkedAt - session.lastSeenAt > SESSION_TTL_MS) {
      store.remove(session.sid);
      return { kind: 'signed_out' };
    }

    if (checkedAt - session.createdAt > SESSION_MAX_AGE_MS) {
      // Idle time alone does not end a session that keeps being used, and the
      // credential outlives a sign-out at the site. This is what stops a tab
      // left open after an account switch from acting as the old member.
      store.remove(session.sid);
      return { kind: 'signed_out' };
    }

    // A session written before the rights cache landed has no rights; refresh
    // it immediately instead of leaving MCP off until the five-minute timer.
    // Writes carry a tighter budget: revocation must stop a mutation inside a
    // minute, while a read may still ride the five-minute window.
    const validationBudget = isSafeMethod(req.method)
      ? REVALIDATE_MS
      : MUTATION_REVALIDATE_MS;
    // A foreground tab asks for an immediate answer: the site may have cut this
    // connection while the tab was hidden, and waiting out the read budget
    // would show a signed-in shell for minutes. The floor keeps repeated focus
    // events from becoming a bootstrap stream.
    const validationFloor = options.forceValidation === true
      ? FORCED_VALIDATE_FLOOR_MS
      : validationBudget;
    const validationDue =
      checkedAt - session.lastValidatedAt >= validationFloor
      || !session.member.rights;
    const expiring = session.tokenExpiresAt !== null
      && session.tokenExpiresAt - checkedAt < REFRESH_LEAD_MS;
    let refreshed = false;
    if (expiring) {
      const renewed = await renew(session);
      if (renewed.kind === 'permanent') return { kind: 'signed_out' };
      if (renewed.kind === 'unavailable') return { kind: 'unavailable' };
      session = renewed.session;
      refreshed = true;
    }

    const completedAt = now();
    if (validationDue) {
      let member = await validate(session);

      if (member.kind === 'unauthorized' && !refreshed) {
        const renewed = await renew(session);
        if (renewed.kind === 'permanent') return { kind: 'signed_out' };
        if (renewed.kind === 'unavailable') return { kind: 'unavailable' };
        session = renewed.session;
        // A refresh proves the OAuth connection still exists, not that the
        // member is still authorized. Re-check with the new credential before
        // serving the request; a second unauthorized answer means the member
        // was deleted, disabled, or lost access, and the session must die.
        member = await validate(session);
      }

      if (member.kind === 'unavailable') return { kind: 'unavailable' };
      if (member.kind === 'unauthorized') {
        store.remove(session.sid);
        return { kind: 'signed_out' };
      }

      store.recordValidation(session.sid, completedAt, member.member);
      session = {
        ...session,
        member: member.member,
        lastSeenAt: completedAt,
        lastValidatedAt: completedAt,
      };
    }

    if (completedAt - session.lastSeenAt >= TOUCH_INTERVAL_MS) {
      store.touch(session.sid, completedAt);
      session = { ...session, lastSeenAt: completedAt };
    }

    return { kind: 'ok', session, issuedAt: cookie.issuedAt };
  }

  /**
   * Validates one stored session now, without a request.
   *
   * The event-stream watchdog and the site's sign-out hint both go through
   * here, so a pushed revocation follows exactly the same rules as an ordinary
   * request: the same deadlines, the same refresh retry, and the same second
   * check after a refresh (a refresh proves the connection exists, not that
   * the member may still use it). A revocation ends every subscribed stream.
   */
  async function revalidateSession(sid: string): Promise<'ok' | 'revoked' | 'unavailable'> {
    let session = store.find(sid);
    if (!session) return 'revoked';
    const at = now();
    if (
      at - session.lastSeenAt > SESSION_TTL_MS
      || at - session.createdAt > SESSION_MAX_AGE_MS
    ) {
      store.remove(sid);
      publishSessionRevoked(sid);
      return 'revoked';
    }

    if (session.tokenExpiresAt !== null && session.tokenExpiresAt - at < REFRESH_LEAD_MS) {
      const renewed = await renew(session);
      if (renewed.kind === 'permanent') {
        store.remove(sid);
        publishSessionRevoked(sid);
        return 'revoked';
      }
      if (renewed.kind === 'unavailable') return 'unavailable';
      session = renewed.session;
    }

    let member = await validate(session);
    if (member.kind === 'unauthorized') {
      const renewed = await renew(session);
      if (renewed.kind === 'permanent') {
        store.remove(sid);
        publishSessionRevoked(sid);
        return 'revoked';
      }
      if (renewed.kind === 'unavailable') return 'unavailable';
      session = renewed.session;
      member = await validate(session);
    }
    if (member.kind === 'unavailable') return 'unavailable';
    if (member.kind === 'unauthorized') {
      store.remove(sid);
      publishSessionRevoked(sid);
      return 'revoked';
    }

    store.recordValidation(sid, now(), member.member);
    return 'ok';
  }

  const gate: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
    // A CORS preflight carries no credentials by design. Let it complete so
    // the browser can then send the real request, which is still checked.
    if (req.method === 'OPTIONS') {
      next();
      return;
    }

    if (req.baseUrl === '/api' && PUBLIC_API_PATHS.has(req.path)) {
      next();
      return;
    }

    if (
      req.baseUrl === '/api'
      && PUBLIC_API_PREFIXES.some((prefix) => req.path.startsWith(prefix))
    ) {
      next();
      return;
    }

    if (req.baseUrl === '/api' && req.path === PUBLIC_API_SELF_TEST) {
      // The self-test must stay callable without a session so deployment
      // probes keep working, but it should report real authentication and
      // model results when the caller does have a session. Resolve the
      // session only when a cookie arrived, and never answer 401/503 from
      // here: the probe describes its own state, and a rejection would hide
      // that state from the caller.
      res.locals.nextoreDiagnostic = true;
      if (!req.headers.cookie?.includes(SESSION_COOKIE + '=')) {
        next();
        return;
      }
      // Resolving can refresh a token and touch the session row, so it needs
      // the same origin guarantee as every other credentialed request.
      if (!isAllowedDesignerOrigin(req, config)) {
        res.status(403).json({
          error: {
            code: 'ORIGIN_REJECTED',
            message: 'Requests must come from the Designer origin.',
          },
        });
        return;
      }
      void resolve(req)
        .then((result) => {
          res.locals.nextoreSessionLookup = result.kind;
          if (result.kind === 'ok') {
            stripClientIdentity(req, result.session.member.id);
            res.locals.nextoreSession = result.session;
            refreshSessionCookieIfStale(res, result.issuedAt, result.session.sid);
          }
          next();
        })
        .catch(next);
      return;
    }

    if (allowRequest?.(req)) {
      next();
      return;
    }

    if (!isAllowedDesignerOrigin(req, config)) {
      res.status(403).json({
        error: {
          code: 'ORIGIN_REJECTED',
          message: 'Requests must come from the Designer origin.',
        },
      });
      return;
    }

    void resolve(req)
      .then((result) => {
        if (result.kind === 'signed_out') {
          clearCookie(res, SESSION_COOKIE, config);
          res.status(401).json({
            error: { code: 'SESSION_REQUIRED', message: 'Sign in through NexTore to continue.' },
          });
          return;
        }

        if (result.kind === 'unavailable') {
          res.status(503).json({
            error: {
              code: 'NEXTORE_UNAVAILABLE',
              message: 'NexTore could not be reached. The session is still valid; try again shortly.',
            },
          });
          return;
        }

        stripClientIdentity(req, result.session.member.id);
        res.locals.nextoreSession = result.session;
        refreshSessionCookieIfStale(res, result.issuedAt, result.session.sid);
        next();
      })
      .catch(next);
  };

  function start(req: Request, res: Response): void {
    const issuedAt = now();
    const state = randomToken(32);
    const verifier = randomToken(48);
    const returnTo = safeReturnTo(req.query.return);
    const share = safeShareToken(req.query.share);

    try {
      setCookie(
        res,
        PENDING_COOKIE,
        signPayload(
          secrets(),
          {
            state,
            verifier,
            returnTo,
            ...(share ? { share } : {}),
            issuedAt,
          } satisfies PendingSignIn,
        ),
        PENDING_TTL_MS,
        config,
      );
    } catch (error) {
      console.warn('[nextore-auth] cannot start sign-in:', error instanceof Error ? error.message : String(error));
      errorPage(
        res,
        'Sign-in is not configured on this Designer instance. Ask the administrator to check the session secret.',
        500,
      );
      return;
    }

    const authorize = new URL('/oauth/authorize', config.baseUrl);
    authorize.searchParams.set('response_type', 'code');
    authorize.searchParams.set('client_id', config.oauthClientId);
    authorize.searchParams.set('redirect_uri', callbackUrl(config));
    // No scope parameter on purpose: the authorization server grants the scope the client was
    // registered for, and a registration is a ceiling - asking for one it does not carry is
    // refused before anyone is asked to approve anything. Omitting it is also what lets one daemon
    // build serve both an older pairing (mcp:tools) and a trusted first-party one (designer)
    // without knowing which it was given.
    authorize.searchParams.set('state', state);
    authorize.searchParams.set('code_challenge', pkceChallenge(verifier));
    authorize.searchParams.set('code_challenge_method', 'S256');

    res.setHeader('Cache-Control', 'no-store');
    res.redirect(302, authorize.toString());
  }

  async function callback(req: Request, res: Response): Promise<void> {
    res.setHeader('Cache-Control', 'no-store');

    const pending = readPendingSignIn(readCookie(req, PENDING_COOKIE));
    clearCookie(res, PENDING_COOKIE, config);

    if (!pending || now() - pending.issuedAt > PENDING_TTL_MS) {
      errorPage(res, 'This sign-in took too long or came from a different browser. Start again.');
      return;
    }

    if (typeof req.query.error === 'string') {
      errorPage(res, 'NexTore did not approve the connection.');
      return;
    }

    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    if (!code || !safeEqual(state, pending.state)) {
      errorPage(res, 'The sign-in response could not be verified. Start again.');
      return;
    }

    let tokens: TokenSet;
    try {
      tokens = await exchangeAuthorizationCode(config, code, pending.verifier);
    } catch (error) {
      const message = error instanceof NextoreOAuthError ? error.message : 'The token exchange failed.';
      const status = error instanceof NextoreOAuthError && error.statusCode !== null && error.statusCode >= 500
        ? 502
        : 400;
      errorPage(res, message, status);
      return;
    }

    const member = await loadMemberOnce(tokens.accessToken);
    if (member.kind === 'unavailable') {
      errorPage(res, 'NexTore accepted the sign-in but the Designer profile could not be read right now.', 502);
      return;
    }
    if (member.kind !== 'ok') {
      errorPage(res, 'NexTore accepted the sign-in but no member profile was returned.', 401);
      return;
    }

    const at = now();
    store.pruneExpired(at - SESSION_TTL_MS);

    const previous = readSessionCookie(readCookie(req, SESSION_COOKIE));
    if (previous) store.remove(previous.sid);

    const session = store.create({
      memberId: member.member.id,
      member: member.member,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      tokenExpiresAt: tokens.expiresAt,
    });

    if (previous && onSessionRotated) {
      try {
        onSessionRotated({ previousSid: previous.sid, sid: session.sid, memberId: member.member.id });
      } catch {
        // A failure here must not fail the sign-in itself.
      }
    }
    if (onSessionEstablished) {
      try {
        onSessionEstablished({ sid: session.sid, memberId: member.member.id });
      } catch {
        // A failed resume must not fail the sign-in itself.
      }
    }
    setSessionCookie(res, session.sid, at);
    // A share-link sign-in returns to the link, not to an arbitrary return path:
    // the landing page redeems the token and writes the grant.
    res.redirect(
      302,
      pending.share
        ? '/s/' + encodeURIComponent(pending.share)
        : safeReturnTo(pending.returnTo),
    );
  }

  function logout(req: Request, res: Response): void {
    if (!isAllowedDesignerOrigin(req, config)) {
      res.status(403).json({
        error: {
          code: 'ORIGIN_REJECTED',
          message: 'Sign-out must come from the Designer origin.',
        },
      });
      return;
    }

    const cookie = readSessionCookie(readCookie(req, SESSION_COOKIE));
    if (cookie) {
      store.remove(cookie.sid);
      // An explicit sign-out is the one revocation the daemon performs
      // without asking the module; every other tab on this session must close
      // its stream and show the signed-out page too.
      publishSessionRevoked(cookie.sid);
    }
    clearCookie(res, SESSION_COOKIE, config);
    clearCookie(res, PENDING_COOKIE, config);
    res.status(204).end();
  }

  async function me(req: Request, res: Response): Promise<void> {
    res.setHeader('Cache-Control', 'no-store');
    // revalidate=1 is the foreground-tab probe: it asks the module whether
    // the OAuth connection still exists instead of trusting the cached
    // validation. Only a session that is still signed in gets this far, so it
    // cannot be used to probe for accounts.
    const result = await resolve(req, { forceValidation: req.query.revalidate === '1' });
    if (result.kind === 'signed_out') {
      clearCookie(res, SESSION_COOKIE, config);
      res.status(401).json({ signedIn: false });
      return;
    }
    if (result.kind === 'unavailable') {
      res.status(503).json({
        error: { code: 'NEXTORE_UNAVAILABLE', message: 'NexTore could not be reached right now.' },
      });
      return;
    }

    refreshSessionCookieIfStale(res, result.issuedAt, result.session.sid);
    res.json({
      signedIn: true,
      member: {
        id: result.session.member.id,
        login: result.session.member.login,
        fullName: result.session.member.fullName,
        language: result.session.member.language,
      },
      // The daemon owns the window; the shell decides when to act on it, and
      // never while the tab is hidden.
      reauthDue: now() - result.session.createdAt >= SILENT_REAUTH_AFTER_MS,
    });
  }

  /**
   * The push channel: one open stream per Designer tab.
   *
   * It carries no identity beyond the cookie that opened it, and it is the
   * only thing the shell listens to. When the daemon ends the session for any
   * reason — the watchdog, a sign-out hint, an expired deadline — the stream
   * receives `session` with `state: revoked` and closes.
   */
  function sessionEvents(req: Request, res: Response): void {
    void resolve(req)
      .then((result) => {
        if (result.kind === 'unavailable') {
          res.status(503).json({
            error: {
              code: 'NEXTORE_UNAVAILABLE',
              message: 'NexTore could not be reached right now.',
            },
          });
          return;
        }
        if (result.kind === 'signed_out') {
          clearCookie(res, SESSION_COOKIE, config);
          res.status(401).json({ signedIn: false });
          return;
        }

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders?.();

        const unsubscribe = subscribeSessionEvents(result.session.sid, res);
        // Says the stream is live; it carries no identity.
        res.write('event: ready\ndata: {"state":"active"}\n\n');
        const keepAlive = setInterval(() => {
          if (res.writableEnded || res.destroyed) return;
          res.write(': keepalive\n\n');
        }, STREAM_KEEPALIVE_MS);
        keepAlive.unref?.();

        let closed = false;
        const cleanup = () => {
          if (closed) return;
          closed = true;
          clearInterval(keepAlive);
          unsubscribe();
        };
        req.on('close', cleanup);
        res.on('close', cleanup);
      })
      .catch(() => {
        if (!res.headersSent) res.status(503).end();
      });
  }

  const hintWindows = new Map<string, { windowStart: number; count: number }>();

  /**
   * Bounds a hostile caller to one member sweep every so often per address.
   *
   * The hint never ends a session by itself — it only starts an authoritative
   * validation — so the limit protects the module from being used as an
   * amplifier rather than protecting any authority.
   */
  function hintAllowed(req: Request): boolean {
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const at = now();
    const entry = hintWindows.get(key);
    if (!entry || at - entry.windowStart >= HINT_WINDOW_MS) {
      if (hintWindows.size > 512) hintWindows.clear();
      hintWindows.set(key, { windowStart: at, count: 1 });
      return true;
    }
    if (entry.count >= HINT_LIMIT) return false;
    entry.count += 1;
    return true;
  }

  /**
   * Sign-out hint from NexToreDesignerModule.
   *
   * The module knows the Designer URL, so it can tell this daemon that a member
   * just signed out. The hint is not trusted as an instruction: it only starts
   * a validation of that member's sessions, so a forged one costs one bootstrap
   * call and can never end a session the module still accepts. That is why no
   * shared secret is needed here — the Designer is a public OAuth client and
   * has no secret to sign with.
   */
  function sessionEnded(req: Request, res: Response): void {
    const body = req.body as { memberId?: unknown } | undefined;
    const memberId = Number(body?.memberId);
    if (!Number.isInteger(memberId) || memberId <= 0) {
      res.status(400).json({
        error: { code: 'BAD_REQUEST', message: 'memberId must be a positive integer.' },
      });
      return;
    }
    if (!hintAllowed(req)) {
      res.status(429).json({
        error: { code: 'RATE_LIMITED', message: 'Too many sign-out hints.' },
      });
      return;
    }

    const sessions = store.listByMember(memberId);
    // Answer first: the caller is the site's sign-out path, which must not
    // wait on this daemon.
    res.status(202).json({ accepted: sessions.length });
    for (const session of sessions) {
      const retry = (index: number): void => {
        const delay = hintRetryDelaysMs[index];
        if (delay === undefined) return;
        const timer = setTimeout(() => {
          void revalidateSession(session.sid)
            .then((result) => {
              // Revoked or unavailable ends this hint: only a still-valid
              // session is worth asking about again. The 15 s watchdog is the
              // outer bound when every attempt lands too early.
              if (result === 'ok') retry(index + 1);
            })
            .catch(() => {
              // A transient failure leaves the session alone; the watchdog retries.
            });
        }, delay);
        timer.unref?.();
      };

      void revalidateSession(session.sid)
        .then((result) => {
          // The revocation sweep and this hint ride the same platform event,
          // so the connection may still look alive right now. A short ladder
          // of re-checks settles it without making the module wait.
          if (result === 'ok') retry(0);
        })
        .catch(() => {
          // A transient failure leaves the session alone; the watchdog retries.
        });
    }
  }

  // One loop for every subscribed session: the browser never schedules this.
  const watchdog = setInterval(() => {
    for (const sid of subscribedSessionIds()) {
      void revalidateSession(sid).catch(() => {
        // A transient module failure must not end a session; the next tick
        // retries.
      });
    }
  }, WATCHDOG_INTERVAL_MS);
  watchdog.unref?.();

  return {
    registerRoutes(app) {
      app.get('/auth/start', start);
      app.get('/auth/callback', (req: Request, res: Response, next: NextFunction) => {
        void callback(req, res).catch(next);
      });
      app.post('/auth/logout', logout);
      app.get('/auth/me', (req: Request, res: Response, next: NextFunction) => {
        void me(req, res).catch(next);
      });
      app.get('/auth/session/events', sessionEvents);
      app.post('/auth/session-ended', sessionEnded);
    },
    gate,
  };
}
