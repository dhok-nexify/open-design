import { describe, expect, it } from 'vitest';
import { projectReadOnlyNotice } from '../src/components/project-readonly-claim';

// NXD-D10/5b: a read-only member must be told WHY, and the edition has no
// collab directory to name an owner from — the module's rights are the reason.

const t = (key: string, vars?: Record<string, string>) =>
  vars ? `${key}:${JSON.stringify(vars)}` : key;

describe('project read-only notice', () => {
  it('explains a NexTore read-only project without naming an owner', () => {
    expect(projectReadOnlyNotice({
      isSharedNonOwner: false,
      viewerCanOnlyRead: true,
      t,
    })).toBe('workspace.readonlyNotice');
  });

  it('still names the owner of a shared team project', () => {
    expect(projectReadOnlyNotice({
      isSharedNonOwner: true,
      ownerDisplayName: 'Ada',
      viewerCanOnlyRead: false,
      t,
    })).toBe('workspace.readonlyNoticeBy:{"owner":"Ada"}');
  });

  it('says nothing when the viewer may write', () => {
    expect(projectReadOnlyNotice({
      isSharedNonOwner: false,
      viewerCanOnlyRead: false,
      t,
    })).toBeUndefined();
  });
});
