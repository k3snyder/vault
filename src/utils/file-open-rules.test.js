import { describe, expect, it } from '@jest/globals';

import { getFileOpenKind, shouldReuseExistingFileTab } from './file-open-rules.js';

describe('file-open-rules', () => {
  it('classifies sketch files as sketch tabs', () => {
    expect(getFileOpenKind('Sketches/Test2.excalidraw')).toBe('sketch');
    expect(getFileOpenKind('Sketches/Test2.EXCALIDRAW')).toBe('sketch');
  });

  it('classifies pdf, csv, boxnote, html, image, and markdown files correctly', () => {
    expect(getFileOpenKind('Research/paper.pdf')).toBe('pdf');
    expect(getFileOpenKind('Tables/data.csv')).toBe('csv');
    expect(getFileOpenKind('Shared/meeting.boxnote')).toBe('boxnote');
    expect(getFileOpenKind('Shared/site.html')).toBe('html');
    expect(getFileOpenKind('Shared/site.HTM')).toBe('html');
    expect(getFileOpenKind('Files/image.png')).toBe('image');
    expect(getFileOpenKind('Notes/spec.md')).toBe('markdown');
  });

  it('forces sketch files to reopen when an old markdown tab exists', () => {
    expect(shouldReuseExistingFileTab({
      openKind: 'sketch',
      existingTabType: 'markdown'
    })).toBe(false);

    expect(shouldReuseExistingFileTab({
      openKind: 'sketch',
      existingTabType: 'sketch'
    })).toBe(true);
  });

  it('keeps csv reopen behavior aligned with plugin state', () => {
    expect(shouldReuseExistingFileTab({
      openKind: 'csv',
      existingTabType: 'markdown',
      csvEnabled: false
    })).toBe(true);

    expect(shouldReuseExistingFileTab({
      openKind: 'csv',
      existingTabType: 'markdown',
      csvEnabled: true
    })).toBe(false);
  });

  it('forces boxnote files to reopen as boxnote tabs', () => {
    expect(shouldReuseExistingFileTab({
      openKind: 'boxnote',
      existingTabType: 'markdown'
    })).toBe(false);

    expect(shouldReuseExistingFileTab({
      openKind: 'boxnote',
      existingTabType: 'boxnote'
    })).toBe(true);
  });

  it('forces html files to reopen as html preview tabs', () => {
    expect(shouldReuseExistingFileTab({
      openKind: 'html',
      existingTabType: 'markdown'
    })).toBe(false);

    expect(shouldReuseExistingFileTab({
      openKind: 'html',
      existingTabType: 'html'
    })).toBe(true);
  });
});
