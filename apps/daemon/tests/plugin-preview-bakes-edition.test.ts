import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { bakedPreviewBlock } from '../src/plugins/plugin-preview-bakes.js';

let tmpDir: string | undefined;

afterEach(async () => {
  vi.unstubAllEnvs();
  if (tmpDir) {
    await rm(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
  }
});

describe('baked previews in the nextore edition', () => {
  it('drops remote-only previews instead of requesting the public asset host', async () => {
    vi.stubEnv('OD_EDITION', 'nextore');
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'od-baked-preview-edition-'));
    await writeFile(path.join(tmpDir, 'manifest.json'), JSON.stringify({
      previews: {
        'html-plugin': {
          video: 'html-plugin/abc123abc123abcd/preview.mp4',
          poster: 'html-plugin/abc123abc123abcd/poster.jpg',
        },
      },
    }));

    expect(bakedPreviewBlock('html-plugin', tmpDir)).toBeNull();
  });

  it('still drops a public OpenDesign base even when the environment sets it', async () => {
    vi.stubEnv('OD_EDITION', 'nextore');
    vi.stubEnv('OD_PLUGIN_PREVIEWS_BASE_URL', 'https://repo-assets.open-design.ai/plugin-previews');
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'od-baked-preview-edition-'));
    await writeFile(path.join(tmpDir, 'manifest.json'), JSON.stringify({
      previews: {
        'html-plugin': {
          video: 'html-plugin/abc123abc123abcd/preview.mp4',
          poster: 'html-plugin/abc123abc123abcd/poster.jpg',
        },
      },
    }));

    expect(bakedPreviewBlock('html-plugin', tmpDir)).toBeNull();
  });

  it('keeps an explicit local base override working', async () => {
    vi.stubEnv('OD_EDITION', 'nextore');
    vi.stubEnv('OD_PLUGIN_PREVIEWS_BASE_URL', 'https://local.example.test/previews/');
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'od-baked-preview-edition-'));
    await writeFile(path.join(tmpDir, 'manifest.json'), JSON.stringify({
      previews: {
        'html-plugin': {
          video: 'html-plugin/abc123abc123abcd/preview.mp4',
          poster: 'html-plugin/abc123abc123abcd/poster.jpg',
        },
      },
    }));

    expect(bakedPreviewBlock('html-plugin', tmpDir)).toEqual({
      poster: 'https://local.example.test/previews/html-plugin/abc123abc123abcd/poster.jpg',
      video: 'https://local.example.test/previews/html-plugin/abc123abc123abcd/preview.mp4',
    });
  });
});
