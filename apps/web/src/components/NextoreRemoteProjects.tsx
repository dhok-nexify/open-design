'use client';

import { useEffect, useState } from 'react';

import {
  fetchNextoreProjectListing,
  remoteOnlyProjects,
  type NextoreProjectEntry,
} from '../nextore-projects';

/**
 * Projects that live in NexTore but have no content on this device (NXD-D09).
 *
 * They are listed read-only: the member can see that the work exists and which
 * device created it, but opening one here would show an empty project until
 * content sync exists. Nothing renders when every project is local.
 */
export function NextoreRemoteProjects() {
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
      <h2 className="nextore-remote-projects-title">On other devices</h2>
      <p className="nextore-remote-projects-hint">
        These projects exist in NexTore but their files are not on this device yet.
      </p>
      <ul className="nextore-remote-projects-list">
        {projects.map((project) => (
          <li
            key={project.designerProjectId}
            className="nextore-remote-project"
            title={project.designerProjectId}
          >
            <span className="nextore-remote-project-name">{project.name}</span>
            <span className="nextore-remote-project-state">not on this device</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
