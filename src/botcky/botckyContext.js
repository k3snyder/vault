export const REQUIRED_BOTCKY_CONTEXT_FIELDS = [
  'active_note',
  'selected_notes',
  'context_notes',
  'vault_path',
  'vault_id',
  'session_id',
  'thread_id',
  'current_folder',
];

export function normalizeBotckyNote(note) {
  if (!note) return null;
  return {
    path: note.path || note.filePath || note.file || '',
    title: note.title || note.name || note.path || note.filePath || 'Untitled',
    content: typeof note.content === 'string' ? note.content : '',
    type: note.type || inferNoteType(note.path || note.filePath || ''),
  };
}

export function inferNoteType(path) {
  const lower = String(path || '').toLowerCase();
  if (lower.endsWith('.csv')) return 'csv';
  if (lower.endsWith('.pdf')) return 'pdf';
  return 'markdown';
}

export function currentFolderFromPath(filePath) {
  if (!filePath || typeof filePath !== 'string') return '';
  const normalized = filePath.replace(/\\/g, '/');
  const index = normalized.lastIndexOf('/');
  return index > 0 ? normalized.slice(0, index) : '';
}

export function createBotckyContextPayload({
  activeNote = null,
  selectedNotes = [],
  contextNotes = [],
  vaultInfo = {},
  vaultPath = '',
  vaultId = '',
  sessionId = '',
  threadId = '',
  currentFolder = '',
} = {}) {
  const active_note = normalizeBotckyNote(activeNote);
  const selected_notes = selectedNotes.map(normalizeBotckyNote).filter(Boolean);
  const normalized_context_notes = contextNotes.map(normalizeBotckyNote).filter(Boolean);
  const resolvedVaultPath = vaultPath || vaultInfo.path || '';
  const resolvedVaultId = vaultId || vaultInfo.id || resolvedVaultPath;
  const resolvedCurrentFolder = currentFolder || currentFolderFromPath(active_note?.path) || '.';

  return {
    active_note,
    selected_notes,
    context_notes: normalized_context_notes,
    vault_path: resolvedVaultPath,
    vault_id: resolvedVaultId,
    session_id: sessionId,
    thread_id: threadId || sessionId,
    current_folder: resolvedCurrentFolder,
  };
}

export function collectBotckyContext(source = {}) {
  const context = source.context && typeof source.context === 'object'
    ? { ...source.context, ...source }
    : source;
  const hasExplicitCurrentFolder =
    Object.prototype.hasOwnProperty.call(context, 'current_folder') ||
    Object.prototype.hasOwnProperty.call(context, 'currentFolder');
  const explicitRequiredAliases = {
    vault_path: ['vault_path', 'vaultPath'],
    vault_id: ['vault_id', 'vaultId'],
    session_id: ['session_id', 'sessionId'],
    thread_id: ['thread_id', 'threadId'],
    current_folder: ['current_folder', 'currentFolder'],
  };

  const payload = createBotckyContextPayload({
    activeNote: context.active_note || context.activeNote || context.activeNoteContent || null,
    selectedNotes: context.selected_notes || context.selectedNotes || [],
    contextNotes: context.context_notes || context.contextNotes || [],
    vaultInfo: context.vaultInfo || {
      path: context.vault_path || context.vaultPath,
      id: context.vault_id || context.vaultId,
    },
    vaultPath: context.vault_path || context.vaultPath || '',
    vaultId: context.vault_id || context.vaultId || '',
    sessionId: context.session_id || context.sessionId || '',
    threadId: context.thread_id || context.threadId || '',
    currentFolder: context.current_folder || context.currentFolder || '',
  });

  if (hasExplicitCurrentFolder && !String(context.current_folder || context.currentFolder || '').trim()) {
    payload.current_folder = '';
  }
  for (const [field, aliases] of Object.entries(explicitRequiredAliases)) {
    const alias = aliases.find(name => Object.prototype.hasOwnProperty.call(context, name));
    if (alias && !String(context[alias] || '').trim()) {
      payload[field] = '';
    }
  }

  validateBotckyContextPayload(payload);
  return payload;
}

export function buildBotckyPromptMetadata(context) {
  const payload = collectBotckyContext(context);
  return {
    active_note: payload.active_note,
    selected_notes: payload.selected_notes,
    context_notes: payload.context_notes,
    vault_path: payload.vault_path,
    vault_id: payload.vault_id,
    session_id: payload.session_id,
    thread_id: payload.thread_id,
    current_folder: payload.current_folder,
  };
}

export function validateBotckyContextPayload(context) {
  const missing = [];
  for (const field of REQUIRED_BOTCKY_CONTEXT_FIELDS) {
    if (!(field in (context || {}))) {
      missing.push(field);
    }
  }
  for (const field of ['vault_path', 'vault_id', 'session_id', 'thread_id', 'current_folder']) {
    if (!String(context?.[field] || '').trim()) {
      missing.push(field);
    }
  }
  const uniqueMissing = [...new Set(missing)];
  if (uniqueMissing.length > 0) {
    throw new Error(`Missing required Botcky context: ${uniqueMissing.join(', ')}`);
  }
  return true;
}
