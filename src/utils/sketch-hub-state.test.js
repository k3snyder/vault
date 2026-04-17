import { describe, expect, it } from '@jest/globals';

import {
  buildSketchHubItems,
  getSketchDisplayName,
  normalizeSketchFileName
} from './sketch-hub-state.js';

describe('sketch-hub-state', () => {
  it('strips the excalidraw extension for display names', () => {
    expect(getSketchDisplayName('Roadmap.excalidraw')).toBe('Roadmap');
    expect(getSketchDisplayName('Roadmap.EXCALIDRAW')).toBe('Roadmap');
  });

  it('normalizes sketch file names to the excalidraw extension', () => {
    expect(normalizeSketchFileName('Brainstorm')).toBe('Brainstorm.excalidraw');
    expect(normalizeSketchFileName('Brainstorm.excalidraw')).toBe('Brainstorm.excalidraw');
    expect(normalizeSketchFileName('')).toBe('');
  });

  it('filters, maps, and sorts sketches by most recently modified', () => {
    const files = [
      {
        path: 'Sketches/Older.excalidraw',
        name: 'Older.excalidraw',
        is_dir: false,
        modified: 100,
        created: 50,
        parent_path: 'Sketches'
      },
      {
        path: 'Sketches/Newer.excalidraw',
        name: 'Newer.excalidraw',
        is_dir: false,
        modified: 200,
        created: 150,
        parent_path: 'Sketches'
      },
      {
        path: 'Notes/spec.md',
        name: 'spec.md',
        is_dir: false,
        modified: 999,
        created: 999,
        parent_path: 'Notes'
      }
    ];

    expect(buildSketchHubItems(files)).toEqual([
      expect.objectContaining({
        path: 'Sketches/Newer.excalidraw',
        displayName: 'Newer'
      }),
      expect.objectContaining({
        path: 'Sketches/Older.excalidraw',
        displayName: 'Older'
      })
    ]);
  });

  it('applies case-insensitive search to display name and path', () => {
    const files = [
      {
        path: 'Sketches/Product/Roadmap.excalidraw',
        name: 'Roadmap.excalidraw',
        is_dir: false,
        modified: 100,
        created: 50,
        parent_path: 'Sketches/Product'
      },
      {
        path: 'Sketches/Exploration/Wireframe.excalidraw',
        name: 'Wireframe.excalidraw',
        is_dir: false,
        modified: 90,
        created: 40,
        parent_path: 'Sketches/Exploration'
      }
    ];

    expect(buildSketchHubItems(files, 'road')).toHaveLength(1);
    expect(buildSketchHubItems(files, 'exploration')).toHaveLength(1);
    expect(buildSketchHubItems(files, 'ROADMAP')[0].displayName).toBe('Roadmap');
  });
});
