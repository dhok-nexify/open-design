import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (relative: string) =>
  readFileSync(new URL(relative, import.meta.url), 'utf8');

const projectRoutes = read('../src/routes/project/index.ts');

function routeBlock(startMarker: string, endMarker: string): string {
  const start = projectRoutes.indexOf(startMarker);
  if (start < 0) throw new Error('missing route: ' + startMarker);
  const end = projectRoutes.indexOf(endMarker, start);
  if (end < 0) throw new Error('missing route end: ' + endMarker);
  return projectRoutes.slice(start, end);
}

describe('NexTore project access routes', () => {
  it('lets a read-only member read their effective rights', () => {
    const block = routeBlock(
      "app.get('/api/projects/:id/nextore-access'",
      "app.get('/api/nextore/projects'",
    );

    expect(block).toContain("{ mode: 'read' }");
    expect(block).not.toContain("capability: 'share'");
  });

  it('requires the manage right to open the permission editor', () => {
    const block = routeBlock(
      "app.get('/api/projects/:id/permission-url'",
      "app.delete('/api/projects/:id'",
    );

    expect(block).toContain("{ mode: 'read', capability: 'share' }");
  });
});
