/**
 * The member's NexTore project list, as the daemon reports it (NXD-D09).
 *
 * `remoteWithoutLocal` is the set of projects that exist in NexTore but have no
 * content on this device. They are worth showing — the member can see that work
 * exists elsewhere — but they cannot be opened here until content sync lands.
 */
export interface NextoreProjectEntry {
  nextoreProjectId: string;
  designerProjectId: string;
  name: string;
  designSystemId?: string | null;
  skillId?: string | null;
  status?: string | null;
  hasLocalContent?: boolean;
}

export interface NextoreProjectListing {
  projects: NextoreProjectEntry[];
  remoteWithoutLocal: string[];
  localWithoutRemote: string[];
}

export function remoteOnlyProjects(
  listing: NextoreProjectListing | null | undefined,
): NextoreProjectEntry[] {
  if (!listing || !Array.isArray(listing.projects)) return [];
  return listing.projects.filter((project) => project?.hasLocalContent !== true && project?.name);
}

export async function fetchNextoreProjectListing(
  fetchImpl: typeof fetch = fetch,
): Promise<NextoreProjectListing | null> {
  try {
    const response = await fetchImpl('/api/nextore/projects', {
      headers: { accept: 'application/json' },
    });
    if (!response.ok) return null;
    const body = (await response.json()) as Partial<NextoreProjectListing>;
    return {
      projects: Array.isArray(body.projects) ? body.projects : [],
      remoteWithoutLocal: Array.isArray(body.remoteWithoutLocal) ? body.remoteWithoutLocal : [],
      localWithoutRemote: Array.isArray(body.localWithoutRemote) ? body.localWithoutRemote : [],
    };
  } catch {
    return null;
  }
}
