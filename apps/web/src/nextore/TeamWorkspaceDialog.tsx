'use client';

import { useEffect, useState, type FormEvent } from 'react';
import {
  NEXTORE_TEAM_WORKSPACE_ROLES,
  type NextoreSessionGroupSummary,
  type NextoreTeamWorkspaceRole,
} from '@open-design/contracts';

import { useT } from '../i18n';
import { fetchNextoreGroups } from './groups';
import { refreshNextoreProjectListing } from './listing-store';

const ROLE_LABEL_KEYS = {
  manager: 'nextoreTeam.roleManager',
  editor: 'nextoreTeam.roleEditor',
  reader: 'nextoreTeam.roleReader',
} as const;

export interface NextoreTeamWorkspaceDialogProps {
  groups: NextoreSessionGroupSummary[];
  onClose: () => void;
  onCreated: () => void;
}

/**
 * Admin-only dialog for creating a team workspace (NXD-D40).
 *
 * The admin names the workspace and gives each selected group one of the three
 * role presets; the module turns those presets into explicit ACL rights.
 */
export function NextoreTeamWorkspaceDialog({
  groups,
  onClose,
  onCreated,
}: NextoreTeamWorkspaceDialogProps) {
  const t = useT();
  const [name, setName] = useState('');
  const [roles, setRoles] = useState<Record<number, NextoreTeamWorkspaceRole>>({});
  const [availableGroups, setAvailableGroups] = useState(groups);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchNextoreGroups().then((next) => {
      // Keep the session groups when the admin directory is unavailable.
      if (cancelled || !next || next.length === 0) return;
      setAvailableGroups(next);
      // Drop any role chosen from the smaller session list that the full
      // directory does not contain, so an invisible grant cannot be submitted.
      setRoles((current) => {
        const nextRoles: Record<number, NextoreTeamWorkspaceRole> = {};
        for (const [id, role] of Object.entries(current)) {
          if (next.some((group) => group.id === Number(id))) {
            nextRoles[Number(id)] = role;
          }
        }
        return nextRoles;
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Escape closes like the backdrop, but never while a create is in flight.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape' && !busy) onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [busy, onClose]);

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
        | { error?: { message?: unknown } }
        | null;
      if (!response.ok) {
        const message = typeof body?.error?.message === 'string' ? body.error.message.trim() : '';
        setError(message || t('nextoreTeam.error'));
        return;
      }
      await refreshNextoreProjectListing();
      onCreated();
    } catch {
      setError(t('nextoreTeam.error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="nextore-dialog-backdrop"
      role="presentation"
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <form
        className="nextore-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t('nextoreTeam.dialogTitle')}
        onClick={(event) => event.stopPropagation()}
        onSubmit={submit}
      >
        <h2 className="nextore-dialog__title">{t('nextoreTeam.dialogTitle')}</h2>

        <label className="nextore-dialog__field">
          <span>{t('nextoreTeam.nameLabel')}</span>
          <input
            type="text"
            value={name}
            maxLength={128}
            autoFocus
            placeholder={t('nextoreTeam.namePlaceholder')}
            onChange={(event) => setName(event.target.value)}
          />
        </label>

        <fieldset className="nextore-dialog__groups">
          <legend>{t('nextoreTeam.groupsLabel')}</legend>
          {availableGroups.length === 0 ? (
            <p className="nextore-dialog__muted">{t('nextoreTeam.noGroups')}</p>
          ) : (
            availableGroups.map((group) => {
              const role = roles[group.id];
              const checked = role !== undefined;
              return (
                <div className="nextore-dialog__group" key={group.id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleGroup(group.id)}
                    />
                    <span>{group.name || 'Group ' + group.id}</span>
                  </label>
                  <select
                    value={role ?? 'reader'}
                    disabled={!checked}
                    aria-label={group.name || 'Group ' + group.id}
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
                  </select>
                </div>
              );
            })
          )}
        </fieldset>

        {error ? (
          <p className="nextore-dialog__error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="nextore-dialog__actions">
          <button type="button" className="nextore-dialog__secondary" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="nextore-dialog__primary" disabled={!canSubmit}>
            {busy ? t('nextoreTeam.creating') : t('nextoreTeam.submit')}
          </button>
        </div>
      </form>
    </div>
  );
}
