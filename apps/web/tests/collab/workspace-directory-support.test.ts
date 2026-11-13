import { beforeEach, describe, expect, it } from 'vitest';

import {
  noteWorkspaceDirectorySupport,
  resetWorkspaceDirectorySupport,
  workspaceDirectoryUnsupported,
} from '../../src/collab/workspace-directory-support';
import { advanceWorkspaceAccountGeneration } from '../../src/collab/workspace-identity';

/**
 * The billing gate demotes to the account scope only when the daemon proves it
 * has no directory endpoint (404). Everything else - a blip, a later success,
 * another account generation - must leave the verified workspace alone.
 */
describe('workspace-directory-support', () => {
  beforeEach(() => resetWorkspaceDirectorySupport());

  it('demotes only on a 404 verdict', () => {
    noteWorkspaceDirectorySupport('unsupported');
    expect(workspaceDirectoryUnsupported()).toBe(true);

    resetWorkspaceDirectorySupport();
    noteWorkspaceDirectorySupport('unknown');
    expect(workspaceDirectoryUnsupported()).toBe(false);

    resetWorkspaceDirectorySupport();
    noteWorkspaceDirectorySupport('supported');
    expect(workspaceDirectoryUnsupported()).toBe(false);
  });

  it('lets a later success clear an earlier 404', () => {
    noteWorkspaceDirectorySupport('unsupported');
    noteWorkspaceDirectorySupport('supported');
    expect(workspaceDirectoryUnsupported()).toBe(false);
  });

  it('never carries a verdict across account generations', () => {
    noteWorkspaceDirectorySupport('unsupported');
    expect(workspaceDirectoryUnsupported()).toBe(true);
    // A sign-in can leave every context field identical while the authority
    // behind it changed; the previous account's verdict must not follow.
    advanceWorkspaceAccountGeneration('unit-test:next-generation');
    expect(workspaceDirectoryUnsupported()).toBe(false);
  });
});
