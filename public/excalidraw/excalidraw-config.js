(() => {
  window.EXCALIDRAW_ASSET_PATH = new URL('./', window.location.href).toString();

  window.onerror = function handleExcalidrawError(message) {
    window.parent.postMessage({
      type: 'error',
      message: `JS Error: ${message}`
    }, '*');
  };
})();
