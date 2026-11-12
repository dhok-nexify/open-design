'use client';

import { useEffect, useId, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  Button,
  Dialog,
  Input,
  Select,
} from '@open-design/components';
import {
  NEXTORE_TEAM_WORKSPACE_ROLES,
  type NextoreSessionGroupSummary,
  type NextoreTeamWorkspaceRole,
} from '@open-design/contracts';

import { Icon } from '../components/Icon';
import { useT } from '../i18n';
import { fetchNextoreGroups } from './groups';
import { refreshNextoreProjectListing } from './listing-store';
import styles from './TeamWorkspaceDialog.module.css';

const ROLE_LABEL_KEYS = {
  manager: 'nextoreTeam.roleManager',
  editor: 'nextoreTeam.roleEditor',
  reader: 'nextoreTeam.roleReader',
} as const;

export interface NextoreCreatedWorkspace {
  id: number;
  name: string;
}

export interface NextoreTeamWorkspaceDialogProps {
  groups: NextoreSessionGroupSummary[];
  onClose: () => void;
  onCreated: (created: NextoreCreatedWorkspace) => void;
}

/**
 * Admin dialog that creates a team workspace (NXD-D40).
 *
 * It renders through the shared Dialog primitive and a portal, because the
 * rail it is opened from has a `backdrop-filter`, which makes it the
 * containing block for any `position: fixed` descendant — without the portal
 * the dialog is trapped and clipped inside the sidebar.
 */
export function NextoreTeamWorkspaceDialog({
  groups,
  onClose,
  onCreated,
}: NextoreTeamWorkspaceDialogProps) {
  const t = useT();
  const titleId = useId();
  const [name, setName] = useState('');
  const [roles, setRoles] = useState<Record<number, NextoreTeamWorkspaceRole>>({});
  const [availableGroups, setAvailableGroups] = useState(groups);
  const [groupQuery, setGroupQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [truncated, setTruncated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The dialog is a modal: lock the page behind it and hand focus back to the
  // control that opened it when it goes away.
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement as HTMLElement | null;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus?.();
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(groupQuery.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [groupQuery]);

  useEffect(() => {
    let cancelled = false;
    void fetchNextoreGroups(debouncedQuery).then((result) => {
      // Keep the session groups when the admin directory is unavailable.
      if (cancelled || !result) return;
      setAvailableGroups(result.groups);
      setTruncated(result.truncated);
      // The unfiltered directory is authoritative: drop roles chosen for groups
      // that no longer exist. A search result must not prune hidden selections.
      if (debouncedQuery !== '' || result.groups.length === 0) return;
      setRoles((current) => {
        const nextRoles: Record<number, NextoreTeamWorkspaceRole> = {};
        for (const [id, role] of Object.entries(current)) {
          if (result.groups.some((group) => group.id === Number(id))) {
            nextRoles[Number(id)] = role;
          }
        }
        return nextRoles;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery]);

  const selectedGroups = Object.keys(roles).length;
  const canSubmit = name.trim().length > 0 && selectedGroups > 0 && !busy;

  function toggleGroup(groupId: number): void {
    setRoles((current) => {
      const next = { ...current };
      if (next[groupId]) {
        delete next[groupId];
      } else {
        next[groupId] = 'reader';
      }
      return next;
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!canSubmit) return;

    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/nextore/workspaces', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          grants: Object.entries(roles).map(([groupId, role]) => ({
            groupId: Number(groupId),
            role,
          })),
        }),
      });
      const body = (await response.json().catch(() => null)) as
        | { id?: unknown; name?: unknown; error?: { message?: unknown } }
        | null;
      if (!response.ok) {
        const message = typeof body?.error?.message === 'string' ? body.error.message.trim() : '';
        setError(message || t('nextoreTeam.error'));
        return;
      }
      const id = Number(body?.id);
      if (!Number.isInteger(id) || id <= 0) {
        setError(t('nextoreTeam.error'));
        return;
      }
      await refreshNextoreProjectListing();
      onCreated({
        id,
        name: typeof body?.name === 'string' && body.name.trim() ? body.name.trim() : name.trim(),
      });
    } catch {
      setError(t('nextoreTeam.error'));
    } finally {
      setBusy(false);
    }
  }

  const dialog = (
    <Dialog
      as="form"
      className={styles.dialog}
      ariaLabelledBy={titleId}
      onClose={onClose}
      closeOnBackdrop={!busy}
      closeOnEscape={!busy}
      onSubmit={submit}
      data-testid="nextore-team-workspace-dialog"
    >
      <div className={styles.header}>
        <h2 id={titleId} className={styles.title}>{t('nextoreTeam.dialogTitle')}</h2>
        <button
          type="button"
          className={styles.close}
          onClick={onClose}
          disabled={busy}
          aria-label={t('common.close')}
        >
          <Icon name="close" size={16} />
        </button>
      </div>

      <div className={styles.body}>
        <label className={styles.field}>
          <span className={styles.label}>{t('nextoreTeam.nameLabel')}</span>
          <Input
            type="text"
            value={name}
            maxLength={128}
            autoFocus
            placeholder={t('nextoreTeam.namePlaceholder')}
            onChange={(event) => setName(event.target.value)}
          />
        </label>

        <div className={styles.groups}>
          <div className={styles.label}>{t('nextoreTeam.groupsLabel')}</div>
          <Input
            type="search"
            className={styles.search}
            value={groupQuery}
            placeholder={t('nextoreTeam.searchGroups')}
            aria-label={t('nextoreTeam.searchGroups')}
            onChange={(event) => setGroupQuery(event.target.value)}
          />
          {truncated ? (
            <p className={styles.hint} role="status">{t('nextoreTeam.truncated')}</p>
          ) : null}

          {availableGroups.length === 0 ? (
            <p className={styles.hint}>
              {groupQuery.trim() ? t('nextoreTeam.noMatches') : t('nextoreTeam.noGroups')}
            </p>
          ) : (
            <ul className={styles.groupList}>
              {availableGroups.map((group) => {
                const role = roles[group.id];
                const checked = role !== undefined;
                return (
                  <li key={group.id} className={styles.groupRow} data-selected={checked ? 'true' : undefined}>
                    <input
                      type="checkbox"
                      id={'nextore-group-' + group.id}
                      checked={checked}
                      onChange={() => toggleGroup(group.id)}
                    />
                    <label className={styles.groupName} htmlFor={'nextore-group-' + group.id} title={group.name}>
                      {group.name || 'Group ' + group.id}
                    </label>
                    <Select
                      className={styles.role}
                      value={role ?? 'reader'}
                      disabled={!checked}
                      aria-label={t('nextoreTeam.roleForGroup', { group: group.name || String(group.id) })}
                      onChange={(event) => {
                        const nextRole = event.target.value as NextoreTeamWorkspaceRole;
                        setRoles((current) => ({ ...current, [group.id]: nextRole }));
                      }}
                    >
                      {NEXTORE_TEAM_WORKSPACE_ROLES.map((candidate) => (
                        <option key={candidate} value={candidate}>
                          {t(ROLE_LABEL_KEYS[candidate])}
                        </option>
                      ))}
                    </Select>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {error ? (
          <p className={styles.error} role="alert">{error}</p>
        ) : null}
      </div>

      <div className={styles.footer}>
        <span className={styles.count}>
          {t('nextoreTeam.selectedCount', { count: String(selectedGroups) })}
        </span>
        <Button type="button" variant="default" onClick={onClose} disabled={busy}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" variant="primary" disabled={!canSubmit}>
          {busy ? t('nextoreTeam.creating') : t('nextoreTeam.submit')}
        </Button>
      </div>
    </Dialog>
  );

  if (typeof document === 'undefined') return dialog;
  return createPortal(dialog, document.body);
}
