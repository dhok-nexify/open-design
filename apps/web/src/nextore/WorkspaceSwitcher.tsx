'use client';

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';

import { Icon } from '../components/Icon';
import { useT } from '../i18n';
import { groupProjectsByWorkspace, type NextoreProjectGroup } from '../nextore-projects';
import { useNextoreProjectListing } from './listing-store';
import { useNextoreSessionView } from './session-view';
import { NextoreTeamWorkspaceDialog } from './TeamWorkspaceDialog';
import {
  resolveWorkspaceContext,
  setNextoreWorkspaceContext,
  useNextoreWorkspaceContext,
} from './workspace-context';

export interface NextoreWorkspaceSwitcherProps {
  /** `rail` is the sidebar row; `chip` is the compact trigger in the main area. */
  variant?: 'rail' | 'chip';
}

function initialOf(name: string): string {
  const trimmed = name.trim();
  return trimmed ? trimmed.charAt(0).toUpperCase() : '·';
}

/**
 * The NexTore workspace switcher (NXD-D40).
 *
 * One row that answers "which workspace am I in, and where does a new project
 * get created". It never lists projects and it never changes what the main
 * area is showing — that is the Projects view scope, which lives in the URL.
 * The workspace list only exists inside the menu, so the rail height is stable
 * no matter how many workspaces or projects a member has.
 */
export function NextoreWorkspaceSwitcher({
  variant = 'rail',
}: NextoreWorkspaceSwitcherProps) {
  const t = useT();
  const listing = useNextoreProjectListing();
  const session = useNextoreSessionView();
  const stored = useNextoreWorkspaceContext();
  const [open, setOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuId = useId();
  const personalLabelId = useId();
  const teamLabelId = useId();

  const groups = useMemo(() => groupProjectsByWorkspace(listing), [listing]);
  const ownedGroups = useMemo(
    () => groups.filter(
      (group): group is NextoreProjectGroup & { workspaceId: number } =>
        !group.sharedOnly && typeof group.workspaceId === 'number' && group.workspaceId > 0,
    ),
    [groups],
  );

  const effective = useMemo(
    () => resolveWorkspaceContext({
      memberId: session?.memberId ?? null,
      groups: ownedGroups,
      stored,
    }),
    [ownedGroups, session?.memberId, stored],
  );

  // Heal the stored context when it points at a workspace this member can no
  // longer see (ACL revoked, workspace deleted, or a different account signed
  // in in the same browser profile).
  useEffect(() => {
    if (!effective) return;
    if (
      stored
      && stored.memberId === effective.memberId
      && stored.workspaceId === effective.workspaceId
      && stored.name === effective.name
    ) {
      return;
    }
    setNextoreWorkspaceContext(effective);
  }, [effective, stored]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent): void {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  function closeMenu(): void {
    setOpen(false);
    triggerRef.current?.focus();
  }

  function chooseWorkspace(group: NextoreProjectGroup & { workspaceId: number }): void {
    if (!session) return;
    setNextoreWorkspaceContext({
      memberId: session.memberId,
      workspaceId: group.workspaceId,
      name: group.workspaceName,
    });
    closeMenu();
  }

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeMenu();
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') {
      return;
    }
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]'),
    );
    if (items.length === 0) return;
    event.preventDefault();
    const activeIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    const nextIndex
      = event.key === 'Home' ? 0
        : event.key === 'End' ? items.length - 1
          : (activeIndex + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
    items[nextIndex]?.focus();
  }

  // Open the menu with the first item focused so arrow keys work immediately.
  useEffect(() => {
    if (!open) return;
    const first = wrapperRef.current?.querySelector<HTMLButtonElement>('[role^="menuitem"]');
    first?.focus();
  }, [open]);

  if (ownedGroups.length === 0) {
    // Nothing to stand in yet: the listing is still loading, or NexTore has no
    // workspace for this member. Say so instead of rendering an empty control.
    if (variant === 'chip') {
      return listing === null
        ? <span className="nextore-chip is-loading" role="status">{t('common.loading')}</span>
        : null;
    }
    return null;
  }

  const currentName = effective?.name || t('nextoreWorkspace.currentUnknown');
  const isAdmin = session?.rights.admin === true;
  const personalGroups = ownedGroups.filter((group) => group.workspaceType === 'personal');
  const teamGroups = ownedGroups.filter((group) => group.workspaceType !== 'personal');

  const trigger = (
    <button
      ref={triggerRef}
      type="button"
      className={variant === 'chip' ? 'nextore-chip' : 'entry-nav-rail__team'}
      aria-haspopup="menu"
      aria-expanded={open}
      aria-controls={open ? menuId : undefined}
      title={currentName}
      onClick={() => setOpen((value) => !value)}
      data-testid="nextore-workspace-switcher"
    >
      {variant === 'rail' ? (
        <span className="entry-nav-rail__team-avatar" aria-hidden>{initialOf(currentName)}</span>
      ) : (
        <Icon name="folder" size={14} />
      )}
      <span className={variant === 'chip' ? 'nextore-chip__name' : 'entry-nav-rail__team-name'}>
        {currentName}
      </span>
      <Icon name="chevron-down" size={14} />
    </button>
  );

  const section = (
    labelId: string,
    label: string,
    rows: (NextoreProjectGroup & { workspaceId: number })[],
  ) => rows.length === 0 ? null : (
    <div role="group" aria-labelledby={labelId}>
      <div className="entry-nav-rail__menu-section" id={labelId}>{label}</div>
      {rows.map((group) => {
        const current = group.workspaceId === effective?.workspaceId;
        return (
          <button
            key={group.workspaceId}
            type="button"
            role="menuitemradio"
            aria-checked={current}
            className={'entry-nav-rail__menu-item' + (current ? ' is-current' : '')}
            onClick={() => chooseWorkspace(group)}
          >
            <span className="entry-nav-rail__team-avatar" aria-hidden>
              {initialOf(group.workspaceName)}
            </span>
            <span className="entry-nav-rail__workspace-menu-name" title={group.workspaceName}>
              {group.workspaceName || t('entry.navProjects')}
            </span>
            {current ? <Icon name="check" size={14} /> : null}
          </button>
        );
      })}
    </div>
  );

  return (
    <div
      ref={wrapperRef}
      className={variant === 'chip' ? 'nextore-switcher is-chip' : 'entry-nav-rail__team-wrap'}
      data-testid="nextore-workspace-switcher-root"
    >
      {trigger}
      {open ? (
        <div
          id={menuId}
          role="menu"
          className="entry-nav-rail__team-menu nextore-switcher__menu"
          onKeyDown={onMenuKeyDown}
        >
          <div className="entry-nav-rail__workspace-list">
            {section(personalLabelId, t('nextoreWorkspace.mine'), personalGroups)}
            {section(teamLabelId, t('nextoreWorkspace.teams'), teamGroups)}
          </div>
          {isAdmin ? (
            <div className="entry-nav-rail__workspace-actions">
              <div className="entry-nav-rail__menu-divider" />
              <button
                type="button"
                role="menuitem"
                className="entry-nav-rail__menu-item"
                onClick={() => {
                  setOpen(false);
                  setDialogOpen(true);
                }}
              >
                <Icon name="plus" size={15} /> {t('nextoreTeam.createAction')}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {dialogOpen && session && effective ? (
        <NextoreTeamWorkspaceDialog
          groups={session.groups}
          onClose={() => setDialogOpen(false)}
          onCreated={(created) => {
            setDialogOpen(false);
            setNextoreWorkspaceContext({
              memberId: session.memberId,
              workspaceId: created.id,
              name: created.name,
            });
          }}
        />
      ) : null}
    </div>
  );
}
