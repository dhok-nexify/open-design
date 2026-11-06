/**
 * Member directory for transcript author chips (NXD-D11).
 *
 * Names live in NexTore; the daemon forwards the lookup with the caller's own
 * session key. Results are cached per page load because a transcript asks for
 * the same handful of ids on every render.
 */
export interface NextoreMemberSummary {
  id: number;
  login?: string;
  fullName?: string;
  email?: string;
}

const memberCache = new Map<number, NextoreMemberSummary>();
let sessionPromise: Promise<number | null> | null = null;
let inflightIds: Promise<NextoreMemberSummary[]> | null = null;
let inflightKey = '';

/** The signed-in member id, or null when the caller has no session. */
export async function fetchCurrentMemberId(
  fetchImpl: typeof fetch = fetch,
): Promise<number | null> {
  sessionPromise ??= (async () => {
    try {
      const response = await fetchImpl('/api/nextore/session', {
        headers: { accept: 'application/json' },
      });
      if (!response.ok) return null;
      const body = (await response.json()) as { memberId?: unknown };
      return typeof body.memberId === 'number' ? body.memberId : null;
    } catch {
      return null;
    }
  })();
  return sessionPromise;
}

/** Directory lookup for a set of ids; missing members are simply absent. */
export async function fetchNextoreMembers(
  ids: readonly number[],
  fetchImpl: typeof fetch = fetch,
): Promise<NextoreMemberSummary[]> {
  const wanted = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))];
  if (wanted.length === 0) return [];
  const pending = wanted.filter((id) => !memberCache.has(id));
  if (pending.length === 0) {
    return wanted.map((id) => memberCache.get(id)).filter((m): m is NextoreMemberSummary => Boolean(m));
  }

  const key = pending.join(',');
  if (inflightIds && inflightKey === key) return inflightIds;

  inflightKey = key;
  inflightIds = (async () => {
    try {
      const response = await fetchImpl('/api/nextore/members?ids=' + key, {
        headers: { accept: 'application/json' },
      });
      if (!response.ok) return [];
      const body = (await response.json()) as { members?: NextoreMemberSummary[] };
      for (const member of body.members ?? []) {
        if (typeof member?.id === 'number') memberCache.set(member.id, member);
      }
      return body.members ?? [];
    } catch {
      return [];
    } finally {
      inflightIds = null;
      inflightKey = '';
    }
  })();
  return inflightIds;
}

/** Full name, else login, else a neutral fallback that is still legible. */
export function memberDisplayName(
  member: NextoreMemberSummary | null | undefined,
  fallbackId: number,
): string {
  const full = member?.fullName?.trim();
  if (full) return full;
  const login = member?.login?.trim();
  if (login) return login;
  return 'Member ' + fallbackId;
}
