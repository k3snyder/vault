import { createBotckyContextPayload, validateBotckyContextPayload } from './botckyContext.js';

describe('Botcky context payload', () => {
  test('emits all seven MVP fields with stable names', () => {
    const context = createBotckyContextPayload({
      activeNote: { path: 'Daily/today.md', content: 'hello' },
      selectedNotes: [{ path: 'Daily/selected.md', content: 'selected' }],
      contextNotes: [{ path: 'Daily/context.md', content: 'context' }],
      vaultInfo: { path: '/vault', id: 'vault-id' },
      sessionId: 'session-id',
      threadId: 'thread-id',
      currentFolder: 'Daily',
    });
    for (const field of ['active_note', 'selected_notes', 'context_notes', 'vault_path', 'vault_id', 'session_id', 'thread_id', 'current_folder']) {
      expect(context).toHaveProperty(field);
    }
    expect(() => validateBotckyContextPayload(context)).not.toThrow();
  });

  test('blocks send when required identity fields are missing', () => {
    const context = createBotckyContextPayload({ sessionId: '', vaultInfo: { path: '/vault' } });
    expect(() => validateBotckyContextPayload(context)).toThrow(/session_id/);
  });
});
