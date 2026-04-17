/**
 * @jest-environment jsdom
 */

import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockInvoke = jest.fn();
const mockOpen = jest.fn();

jest.unstable_mockModule('@tauri-apps/api/core', () => ({
  invoke: mockInvoke,
}));

jest.unstable_mockModule('@tauri-apps/plugin-shell', () => ({
  open: mockOpen,
}));

jest.unstable_mockModule('./boxnote.css', () => ({}));

const { BoxNoteViewer } = await import('./BoxNoteViewer.js');

describe('BoxNoteViewer', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockOpen.mockReset();
    window.currentVaultPath = '/Users/test/Library/CloudStorage/Box-Box/My Box Notes';
    window.showNotification = jest.fn();
  });

  it('renders a separate note title block above the document body', async () => {
    mockInvoke.mockImplementation(async (command) => {
      if (command === 'read_file_content') {
        return JSON.stringify({
          schema_version: 1,
          version: 3,
          doc: {
            type: 'doc',
            content: [
              {
                type: 'heading',
                attrs: { level: 1 },
                content: [{ type: 'text', text: 'Document Heading' }],
              },
              {
                type: 'heading',
                attrs: { level: 2 },
                content: [{ type: 'text', text: 'Section Heading' }],
              },
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Body copy.' }],
              },
            ],
          },
          comments: [],
          annotations: [],
        });
      }

      throw new Error(`Unexpected command: ${command}`);
    });

    const viewer = new BoxNoteViewer('Shared/Syntax Test Document.boxnote', null, 'pane-1');
    const container = await viewer.mount();

    expect(container.querySelector('.boxnote-note-title')?.textContent).toBe('Syntax Test Document');
    expect(container.querySelector('.boxnote-filename')?.textContent).toBe('Syntax Test Document.boxnote');
    expect(container.querySelector('.boxnote-note-body h1')?.textContent).toBe('Document Heading');
    expect(container.querySelector('.boxnote-note-body h2')?.textContent).toBe('Section Heading');
    expect(viewer.getContent()).toContain('Document Heading');
    expect(viewer.getContent()).toContain('Body copy.');
  });

  it('renders native Box highlight marks without showing unsupported-content warnings', async () => {
    mockInvoke.mockImplementation(async (command) => {
      if (command === 'read_file_content') {
        return JSON.stringify({
          schema_version: 1,
          version: 4,
          doc: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [
                  {
                    type: 'text',
                    text: 'Highlighted guidance',
                    marks: [{ type: 'highlight', attrs: { color: '#fdf0d1' } }],
                  },
                ],
              },
            ],
          },
          comments: [],
          annotations: [],
        });
      }

      throw new Error(`Unexpected command: ${command}`);
    });

    const viewer = new BoxNoteViewer('Shared/switch apple developer account.boxnote', null, 'pane-1');
    const container = await viewer.mount();

    expect(container.querySelector('.boxnote-warning-banner')?.classList.contains('hidden')).toBe(true);
    expect(container.querySelector('.boxnote-note-body mark.boxnote-highlight')?.textContent).toBe('Highlighted guidance');
  });
});
