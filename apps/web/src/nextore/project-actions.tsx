/**
 * Project-level NexTore entries and notices.
 *
 * NXD-D12 (open the site's permission editor) and NXD-D20 (create a revocable
 * share link) used to live inside upstream's project header. When upstream
 * rewrote that header the call sites vanished while the handlers stayed behind,
 * so the surface looked implemented but was unreachable. Keeping the entries in
 * this module — and mounting it from one explicit slot — gives the regression a
 * single, testable home.
 */
import type { ReactElement } from 'react';

import { useT } from '../i18n';
import type { NextoreProjectAccessView } from './access';
import { Icon } from '../components/Icon';

/**
 * Which share surface an artifact entry must open.
 *
 * `dialog` — NexTore edition, member can manage, share links enabled: the same
 * artifact dialog the project header opens.
 * `menu`   — every other edition keeps the legacy anchored share menu.
 * `hidden` — NexTore edition without the right or with share links switched
 * off: the entry must not exist, because it could only fail.
 *
 * The header entry and the artifact-card entry both read this, so one action
 * never looks like two different features depending on where it was clicked.
 */
export function artifactShareEntryMode(
  edition: string | undefined,
  access: { canManage?: boolean; shareLinksEnabled?: boolean } | null,
): 'dialog' | 'menu' | 'hidden' {
  if (edition !== 'nextore') return 'menu';
  if (access?.canManage !== true) return 'hidden';
  if (access?.shareLinksEnabled === false) return 'hidden';
  return 'dialog';
}

export function NextoreProjectActions({
  access,
  onOpenProjectShare,
  onOpenPermissions,
}: {
  access: NextoreProjectAccessView | null;
  /**
   * Whole-project (folder) share only. File links are created from the file row
   * that names the file: a header entry cannot say which page it would share.
   */
  onOpenProjectShare: () => void;
  onOpenPermissions: () => void;
}): ReactElement {
  const t = useT();
  // One rule for every share entry: header, artifact card and next-step row all
  // read artifactShareEntryMode so the same action never looks like two
  // different features depending on where it was clicked.
  const shareMode = artifactShareEntryMode('nextore', access);
  const canManage = access?.canManage === true;

  return (
    <>
      {shareMode === 'dialog' ? (
        <button
          type="button"
          className="chrome-action chrome-action-secondary chrome-action-with-label chrome-action-text-only"
          data-testid="nextore-project-share"
          onClick={onOpenProjectShare}
        >
          <Icon name="folder" size={14} />
          {t('nextore.project.share.action')}
        </button>
      ) : null}
      {/* The ACL editor is a management surface, not a viewer: the module
          refuses every read for a member without CanManage, so offering the
          entry to a reader only produces a "could not load" drawer. It also
          stays hidden until the access read lands, because an unknown answer
          is not proof of the right. */}
      {canManage ? (
        <button
          type="button"
          className="chrome-action chrome-action-secondary chrome-action-with-label chrome-action-text-only"
          data-testid="nextore-manage-permissions"
          onClick={onOpenPermissions}
        >
          <Icon name="lock" size={14} />
          {t('plugins.availableDetails.permissions')}
        </button>
      ) : null}
    </>
  );
}

/**
 * Shown while NexTore reports the project as deleted: its files stay on this
 * server and it is hidden automatically after 14 days unless it comes back.
 * Reuses the read-only banner shell so it sits in the same status row.
 */
export function NextoreProjectQuarantineNotice({ message }: { message: string }): ReactElement {
  return (
    <div
      className="workspace-readonly-notice"
      data-tone="warning"
      data-testid="nextore-project-quarantined"
      role="status"
    >
      <Icon name="info" size={14} />
      <span>{message}</span>
    </div>
  );
}
