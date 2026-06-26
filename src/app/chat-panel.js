export async function initializeChatPanel({
  documentRef = document,
  windowRef = window,
  PanelClass,
  appContext,
  setChatPanel = () => {},
  log = console,
} = {}) {
  log.debug('💬 Initializing Enhanced Chat Panel...');

  const chatContainer = documentRef.getElementById('chat-panel-container');
  if (!chatContainer) {
    console.error('❌ Chat panel container not found in DOM');
    log.debug('🔍 Available containers:', documentRef.querySelectorAll('[id*="chat"]'));
    return null;
  }

  try {
    log.debug('🔧 Creating EnhancedChatPanel instance...');
    const chatPanel = new PanelClass();
    appContext.chat.panel = chatPanel;
    setChatPanel(chatPanel);

    log.debug('📌 Mounting chat panel to container...');
    await chatPanel.mount(chatContainer);
    log.debug('✅ Enhanced Chat Panel initialized successfully');
    log.debug('🔍 Chat panel object:', chatPanel);
    return chatPanel;
  } catch (error) {
    console.error('❌ Failed to initialize Enhanced Chat Panel:', error);
    console.error('📋 Error details:', error.stack);
    return null;
  }
}
