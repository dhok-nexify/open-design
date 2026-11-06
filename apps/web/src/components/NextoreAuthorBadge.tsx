'use client';

import { useEffect, useState } from 'react';

import {
  fetchCurrentMemberId,
  fetchNextoreMembers,
  memberDisplayName,
} from '../nextore-members';

/**
 * Shows who wrote a user turn, but only when it was someone else (NXD-D11).
 *
 * Labelling your own messages adds noise; in a shared project the other
 * member's name is the whole point. The lookup is cached per page load, so a
 * long transcript costs one directory call, not one per message.
 */
export function NextoreAuthorBadge({
  authorMemberId,
}: {
  authorMemberId?: number | null;
}) {
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    if (typeof authorMemberId !== 'number') {
      setName(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const me = await fetchCurrentMemberId();
      if (cancelled) return;
      if (me === authorMemberId) {
        setName(null);
        return;
      }
      const members = await fetchNextoreMembers([authorMemberId]);
      if (!cancelled) setName(memberDisplayName(members[0], authorMemberId));
    })();
    return () => {
      cancelled = true;
    };
  }, [authorMemberId]);

  if (!name) return null;
  return (
    <span className="nextore-author-badge" data-testid="nextore-author-badge">
      {name}
    </span>
  );
}
