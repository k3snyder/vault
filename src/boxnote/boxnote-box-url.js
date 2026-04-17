import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-shell';

function getVaultPath() {
  return typeof window !== 'undefined' ? window.currentVaultPath || '' : '';
}

export function isLikelyBoxDrivePath(vaultPath = getVaultPath()) {
  return /\/Library\/CloudStorage\/Box-[^/]+(?:\/|$)/u.test(String(vaultPath || ''));
}

export async function resolveBoxUrl(filePath) {
  const boxId = await invoke('resolve_box_file_id', { filePath });
  return boxId ? `https://app.box.com/notes/${boxId}` : null;
}

export async function openBoxNoteOnBox(filePath) {
  if (!isLikelyBoxDrivePath()) {
    window.showNotification?.('This file is not in a Box Drive folder.', 'error');
    return null;
  }

  const url = await resolveBoxUrl(filePath);
  if (!url) {
    window.showNotification?.('Could not find this file on Box.com.', 'error');
    return null;
  }

  await open(url);
  return url;
}
