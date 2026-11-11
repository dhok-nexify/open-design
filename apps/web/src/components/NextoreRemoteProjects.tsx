'use client';

import { useEffect, useState } from 'react';

import {
  fetchNextoreProjectListing,
  remoteOnlyProjects,
  type NextoreProjectEntry,
} from '../nextore-projects';

import { useT } from '../i18n';

/**
 * Projects that live in NexTore but have no content on this device (NXD-D09).
 *
 * They are listed read-only: the member can see that the work exists and which
 * device created it, but opening one here would show an empty project until
 * content sync exists. Nothing renders when every project is local.
 */
export function NextoreRemoteProjects() {
  const t = useT();
  const [projects, setProjects] = useState<NextoreProjectEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    void fetchNextoreProjectListing().then((listing) => {
      if (cancelled) return;
      setProjects(remoteOnlyProjects(listing));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (projects.length === 0) return null;
  return (
    <section className="nextore-remote-projects" data-testid="nextore-remote-projects">
      <h2 className="nextore-remote-projects-title">{t('nextoreRemote.title')}</h2>
      <p className="nextore-remote-projects-hint">
        {t('nextoreRemote.hint')}
      </p>
      <ul className="nextore-remote-projects-list">
        {projects.map((project) => (
          <li
            key={project.designerProjectId}
            className="nextore-remote-project"
            title={project.designerProjectId}
          >
            <span className="nextore-remote-project-name">{project.name}</span>
            <span className="nextore-remote-project-state">{t('nextoreRemote.notOnDevice')}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
