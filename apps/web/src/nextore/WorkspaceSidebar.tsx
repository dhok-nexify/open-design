'use client';

import { useEffect, useState } from 'react';

import { useT } from '../i18n';
import {
  fetchNextoreProjectListing,
  groupProjectsByWorkspace,
  type NextoreProjectGroup,
} from '../nextore-projects';

/**
 * NexTore workspaces and their projects in the entry rail (NXD-D09).
 *
 * This replaces the upstream cloud workspace switcher in the NexTore edition.
 * It lists what the module says the member can see; a project that has no
 * content on this device yet is shown as a read-only row instead of a link.
 */
export function NextoreWorkspaceSidebar({ refreshKey }: { refreshKey?: string }) {
  const t = useT();
  const [groups, setGroups] = useState<NextoreProjectGroup[]>([]);

  useEffect(() => {
    let cancelled = false;
    void fetchNextoreProjectListing().then((listing) => {
      if (cancelled) return;
      setGroups(groupProjectsByWorkspace(listing));
    });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  if (groups.length === 0) return null;
  return (
    <div className="nextore-rail" data-testid="nextore-workspace-sidebar">
      {groups.map((group, index) => {
        const name = group.workspaceName || t('entry.navProjects');
        return (
          <section
            key={group.workspaceId ?? 'unassigned-' + index}
            className="nextore-rail__workspace"
            data-testid="nextore-rail-workspace"
          >
            <h3 className="nextore-rail__workspace-name" title={name}>
              {name}
            </h3>
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
    </div>
  );
}
