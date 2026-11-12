'use client';

import { useEffect, useMemo, useState } from 'react';

import { useT } from '../i18n';
import { groupProjectsByWorkspace, type NextoreProjectGroup } from '../nextore-projects';
import { refreshNextoreProjectListing, useNextoreProjectListing } from './listing-store';
import { useNextoreSessionView } from './session-view';
import { NextoreTeamWorkspaceDialog } from './TeamWorkspaceDialog';
import {
  clearNextoreWorkspaceSelection,
  selectNextoreWorkspace,
  useNextoreWorkspaceSelection,
} from './workspace-selection';

export interface NextoreWorkspaceSidebarProps {
  refreshKey?: string;
  /** Switches the main area to the workspace-scoped project list. */
  onSelectWorkspace?: () => void;
}

/**
 * NexTore workspaces and their projects in the entry rail (NXD-D09/D39).
 *
 * Workspace headers select the workspace, which scopes the projects view.
 * A project shared out of someone else's personal workspace never gets its own
 * workspace row: it appears under "Shared with you", and the workspace header
 * button stays absent for that reason.
 */
export function NextoreWorkspaceSidebar({
  refreshKey,
  onSelectWorkspace,
}: NextoreWorkspaceSidebarProps) {
  const t = useT();
  const listing = useNextoreProjectListing();
  const session = useNextoreSessionView();
  const selected = useNextoreWorkspaceSelection();
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    if (!refreshKey) return;
    void refreshNextoreProjectListing();
  }, [refreshKey]);

  const groups = useMemo(() => groupProjectsByWorkspace(listing), [listing]);
  const ownedGroups = groups.filter((group) => !group.sharedOnly);
  const sharedGroups = groups.filter((group) => group.sharedOnly);
  const sharedProjects = useMemo(() => {
    const seen = new Set<string>();
    const projects: Array<{ project: NextoreProjectGroup['projects'][number]; workspaceName: string }> = [];
    for (const group of groups) {
      if (!group.sharedOnly) continue;
      for (const project of group.projects) {
        if (seen.has(project.designerProjectId)) continue;
        seen.add(project.designerProjectId);
        projects.push({ project, workspaceName: group.workspaceName });
      }
    }
    return projects;
  }, [groups]);

  const isAdmin = session?.rights.admin === true;

  function chooseGroup(group: NextoreProjectGroup): void {
    if (group.workspaceId == null) return;
    selectNextoreWorkspace({
      id: group.workspaceId,
      name: group.workspaceName,
      sharedOnly: group.sharedOnly,
    });
    onSelectWorkspace?.();
  }

  if (groups.length === 0 && !isAdmin) return null;

  return (
    <div className="nextore-rail" data-testid="nextore-workspace-sidebar">
      {selected ? (
        <button
          type="button"
          className="nextore-rail__all"
          onClick={() => {
            clearNextoreWorkspaceSelection();
            onSelectWorkspace?.();
          }}
        >
          {t('nextoreWorkspace.allProjects')}
        </button>
      ) : null}

      {ownedGroups.map((group) => {
        const name = group.workspaceName || t('entry.navProjects');
        const active = selected?.id === group.workspaceId;
        return (
          <section
            key={group.workspaceId ?? 'unassigned'}
            className="nextore-rail__workspace"
            data-testid="nextore-rail-workspace"
          >
            {group.workspaceId == null ? (
              <h3 className="nextore-rail__workspace-name" title={name}>
                {name}
              </h3>
            ) : (
              <button
                type="button"
                className={
                  'nextore-rail__workspace-name' + (active ? ' is-selected' : '')
                }
                title={name}
                aria-pressed={active}
                onClick={() => chooseGroup(group)}
              >
                {name}
              </button>
            )}
            {group.projects.length > 0 ? (
              <ul className="nextore-rail__projects">
                {group.projects.map((project) => {
                  const local = project.hasLocalContent === true;
                  return (
                    <li key={project.designerProjectId}>
                      {local ? (
                        <a
                          className="nextore-rail__project"
                          href={'/projects/' + encodeURIComponent(project.designerProjectId)}
                          title={project.name}
                        >
                          {project.name}
                        </a>
                      ) : (
                        <span
                          className="nextore-rail__project is-remote"
                          title={t('nextoreRemote.notOnDeviceTitle', { project: project.name })}
                        >
                          {project.name}
                          <span className="nextore-rail__badge">{t('nextoreRemote.remoteBadge')}</span>
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </section>
        );
      })}

      {sharedProjects.length > 0 ? (
        <section className="nextore-rail__workspace nextore-rail__shared">
          <h3 className="nextore-rail__workspace-name">{t('nextoreShared.title')}</h3>
          <ul className="nextore-rail__projects">
            {sharedProjects.map(({ project, workspaceName }) => {
              const local = project.hasLocalContent === true;
              return (
                <li key={project.designerProjectId}>
                  {local ? (
                    <a
                      className="nextore-rail__project"
                      href={'/projects/' + encodeURIComponent(project.designerProjectId)}
                      title={workspaceName ? project.name + ' — ' + workspaceName : project.name}
                    >
                      {project.name}
                    </a>
                  ) : (
                    <span
                      className="nextore-rail__project is-remote"
                      title={t('nextoreRemote.notOnDeviceTitle', { project: project.name })}
                    >
                      {project.name}
                      <span className="nextore-rail__badge">{t('nextoreRemote.remoteBadge')}</span>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {isAdmin ? (
        <button
          type="button"
          className="nextore-rail__create-workspace"
          onClick={() => setDialogOpen(true)}
        >
          + {t('nextoreTeam.createAction')}
        </button>
      ) : null}

      {dialogOpen && session ? (
        <NextoreTeamWorkspaceDialog
          groups={session.groups}
          onClose={() => setDialogOpen(false)}
          onCreated={() => setDialogOpen(false)}
        />
      ) : null}
    </div>
  );
}
