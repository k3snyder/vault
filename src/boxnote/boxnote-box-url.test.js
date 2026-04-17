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

const {
  isLikelyBoxDrivePath,
  openBoxNoteOnBox,
  resolveBoxUrl,
} = await import('./boxnote-box-url.js');

describe('boxnote-box-url', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockOpen.mockReset();
    window.showNotification = jest.fn();
    window.currentVaultPath = '/Users/test/Library/CloudStorage/Box-Box/My Box Notes';
  });

  it('detects Box Drive vault paths', () => {
    expect(isLikelyBoxDrivePath('/Users/test/Library/CloudStorage/Box-Box/My Box Notes')).toBe(true);
    expect(isLikelyBoxDrivePath('/Users/test/Documents/Notes')).toBe(false);
  });

  it('builds a Box note URL from the resolved id', async () => {
    mockInvoke.mockResolvedValue('2160296358319');

    await expect(resolveBoxUrl('Vertical Raise.boxnote')).resolves.toBe(
      'https://app.box.com/notes/2160296358319'
    );
    expect(mockInvoke).toHaveBeenCalledWith('resolve_box_file_id', { filePath: 'Vertical Raise.boxnote' });
  });

  it('opens the resolved Box note URL in the browser', async () => {
    mockInvoke.mockResolvedValue('2160296358319');

    await openBoxNoteOnBox('Vertical Raise.boxnote');

    expect(mockOpen).toHaveBeenCalledWith('https://app.box.com/notes/2160296358319');
    expect(window.showNotification).not.toHaveBeenCalled();
  });

  it('shows an error when the file is not in Box Drive', async () => {
    window.currentVaultPath = '/Users/test/Documents/Vault';

    await expect(openBoxNoteOnBox('Vertical Raise.boxnote')).resolves.toBeNull();
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(window.showNotification).toHaveBeenCalledWith('This file is not in a Box Drive folder.', 'error');
  });
});
