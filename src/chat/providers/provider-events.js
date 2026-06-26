export function normalizeErrorText(error, fallback = 'Provider request failed') {
  if (!error) {
    return fallback;
  }

  if (typeof error === 'string') {
    return error;
  }

  return error.message || error.toString?.() || fallback;
}

export function extractResponseText(response) {
  if (typeof response === 'string') {
    return response;
  }

  return response?.choices?.[0]?.message?.content || response?.content || '';
}

export function normalizeHistoryMessages(history = [], currentMessage = '') {
  return history
    .filter((msg) => msg.type !== 'error' && msg.type !== 'context')
    .map((msg) => ({
      role: msg.type === 'user' ? 'user' : 'assistant',
      content: msg.content,
    }))
    .filter((msg) => !(msg.role === 'user' && msg.content === currentMessage));
}

export async function buildProviderMessages(
  sdk,
  { message, context = [], tagEnhancement = null, history = [] },
) {
  const messages = await sdk.formatMessages(message, context, tagEnhancement);
  const systemMessages = messages.filter((m) => m.role === 'system');
  const currentUserMessage = messages.find((m) => m.role === 'user');
  const formattedHistory = normalizeHistoryMessages(history, message);

  return [...systemMessages, ...formattedHistory.slice(-10), currentUserMessage].filter(Boolean);
}
