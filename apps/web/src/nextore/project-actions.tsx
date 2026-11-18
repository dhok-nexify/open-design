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

export function NextoreProjectActions({
  access,
  onOpenShareLinks,
  onOpenPermissions,
}: {
  access: NextoreProjectAccessView | null;
  onOpenShareLinks: () => void;
  onOpenPermissions: () => void;
}): ReactElement {
  const t = useT();
  // A project whose NexTore record is not known yet keeps the local writable
  // default, so only an explicit false hides the share entry.
  const canManage = access?.canManage === true;
  const shareLinksEnabled = access?.shareLinksEnabled !== false;

  return (
    <>
      {canManage && shareLinksEnabled ? (
        <button
          type="button"
          className="chrome-action chrome-action-secondary chrome-action-with-label chrome-action-text-only"
          data-testid="nextore-share-link"
          onClick={onOpenShareLinks}
        >
          {t('fileViewer.publishSingleFileTitle')}
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
