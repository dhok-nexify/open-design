/**
 * Projects NexTore no longer knows about (NXD-D08).
 *
 * The daemon quarantines them instead of deleting them — Designer holds the
 * only copy of the content — so the UI has to say so where the project is
 * open. One read per page load; a failed or malformed answer means "nothing
 * quarantined" rather than a banner about a project that is fine.
 */
let cached: Promise<Set<string>> | null = null;

export async function fetchQuarantinedProjectIds(
  fetchImpl: typeof fetch = fetch,
): Promise<Set<string>> {
  cached ??= (async () => {
    try {
      const response = await fetchImpl('/api/nextore/projects/gc', {
        headers: { accept: 'application/json' },
      });
      if (!response.ok) return new Set<string>();
      const body = (await response.json()) as { candidates?: Array<{ projectId?: unknown }> };
      const ids = new Set<string>();
      for (const candidate of body.candidates ?? []) {
        if (typeof candidate?.projectId === 'string') ids.add(candidate.projectId);
      }
      return ids;
    } catch {
      return new Set<string>();
    }
  })();
  return cached;
}

/** Test hook: forget the cached page-load read. */
export function resetQuarantinedProjectCache(): void {
  cached = null;
}
