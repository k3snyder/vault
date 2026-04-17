import React from 'react';
import ReactDOM from 'react-dom/client';
import { Excalidraw, exportToBlob, MainMenu } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';

declare global {
  interface Window {
    EXCALIDRAW_ASSET_PATH: string;
    loadScene: (jsonString: string) => void;
    setTheme: (theme: string) => void;
    getSceneData: () => void;
    clearScene: () => void;
    exportToPNG: () => void;
    exportToSVG: () => void;
    copyToClipboard: () => void;
  }
}

window.EXCALIDRAW_ASSET_PATH = './';

// Hide Library button
const style = document.createElement('style');
style.textContent = '.excalidraw .sidebar-trigger { display: none !important; }';
document.head.appendChild(style);

let excalidrawAPI: any = null;
let pendingInitialData: any = null;

function debounce<T extends (...args: any[]) => void>(func: T, wait: number): T {
  let timeout: ReturnType<typeof setTimeout>;
  return ((...args: any[]) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  }) as T;
}

function postToParent(message: any) {
  window.parent.postMessage(message, '*');
}

const handleChange = debounce((elements: any, appState: any, files: any) => {
  postToParent({
    type: 'change',
    data: {
      type: 'excalidraw',
      version: 2,
      source: 'vault-desktop',
      elements,
      appState: {
        theme: appState.theme,
        viewBackgroundColor: appState.viewBackgroundColor
      },
      files: files || {}
    }
  });
}, 500);

// Listen for bridge calls from parent
window.addEventListener('message', (event) => {
  if (event.data?.type !== 'bridgeCall') return;
  const { method, args } = event.data;
  if ((window as any)[method]) {
    (window as any)[method](...(args || []));
  }
});

// Bridge functions
window.loadScene = function(jsonString: string) {
  try {
    const data = JSON.parse(jsonString);
    if (excalidrawAPI) {
      excalidrawAPI.updateScene(data);
    } else {
      pendingInitialData = data;
    }
  } catch (e: any) {
    postToParent({ type: 'error', message: e.message });
  }
};

window.setTheme = function(theme: string) {
  if (excalidrawAPI) {
    excalidrawAPI.updateScene({ appState: { theme } });
  }
};

window.getSceneData = function() {
  if (!excalidrawAPI) {
    postToParent({ type: 'sceneData', data: '{}' });
    return;
  }
  const elements = excalidrawAPI.getSceneElements();
  const appState = excalidrawAPI.getAppState();
  const files = excalidrawAPI.getFiles();
  postToParent({
    type: 'sceneData',
    data: JSON.stringify({
      type: 'excalidraw',
      version: 2,
      source: 'vault-desktop',
      elements,
      appState: {
        theme: appState.theme,
        viewBackgroundColor: appState.viewBackgroundColor
      },
      files: files || {}
    })
  });
};

window.clearScene = function() {
  if (excalidrawAPI) {
    excalidrawAPI.resetScene();
  }
};

window.exportToPNG = function() {
  if (!excalidrawAPI) {
    postToParent({ type: 'exportComplete', success: false, error: 'API not ready' });
    return;
  }
  exportToBlob({
    elements: excalidrawAPI.getSceneElements(),
    appState: excalidrawAPI.getAppState(),
    files: excalidrawAPI.getFiles(),
    mimeType: 'image/png'
  }).then((blob: Blob) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = (reader.result as string).split(',')[1];
      postToParent({ type: 'exportComplete', success: true, format: 'png', data: base64 });
    };
    reader.readAsDataURL(blob);
  }).catch((e: any) => {
    postToParent({ type: 'exportComplete', success: false, error: e.message });
  });
};

window.exportToSVG = function() {
  if (!excalidrawAPI) {
    postToParent({ type: 'exportComplete', success: false, error: 'API not ready' });
    return;
  }
  exportToBlob({
    elements: excalidrawAPI.getSceneElements(),
    appState: excalidrawAPI.getAppState(),
    files: excalidrawAPI.getFiles(),
    mimeType: 'image/svg+xml'
  }).then((blob: Blob) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = (reader.result as string).split(',')[1];
      postToParent({ type: 'exportComplete', success: true, format: 'svg', data: base64 });
    };
    reader.readAsDataURL(blob);
  }).catch((e: any) => {
    postToParent({ type: 'exportComplete', success: false, error: e.message });
  });
};

window.copyToClipboard = function() {
  if (!excalidrawAPI) {
    postToParent({ type: 'clipboardData', success: false, error: 'API not ready' });
    return;
  }
  exportToBlob({
    elements: excalidrawAPI.getSceneElements(),
    appState: excalidrawAPI.getAppState(),
    files: excalidrawAPI.getFiles(),
    mimeType: 'image/png'
  }).then((blob: Blob) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = (reader.result as string).split(',')[1];
      postToParent({ type: 'clipboardData', success: true, data: base64 });
    };
    reader.readAsDataURL(blob);
  }).catch((e: any) => {
    postToParent({ type: 'clipboardData', success: false, error: e.message });
  });
};

function App() {
  const customMenu = React.createElement(MainMenu, null,
    React.createElement(MainMenu.DefaultItems.ClearCanvas, null),
    React.createElement(MainMenu.DefaultItems.ToggleTheme, null),
    React.createElement(MainMenu.DefaultItems.ChangeCanvasBackground, null)
  );

  return React.createElement(Excalidraw, {
    excalidrawAPI: (api: any) => {
      excalidrawAPI = api;
      if (pendingInitialData) {
        api.updateScene(pendingInitialData);
        pendingInitialData = null;
      }
      postToParent({ type: 'ready' });
    },
    onChange: (elements: any, appState: any, files: any) => {
      handleChange(elements, appState, files);
    },
    initialData: pendingInitialData,
    UIOptions: {
      canvasActions: {
        loadScene: false,
        saveToActiveFile: false,
        saveAsImage: false,
        export: { saveFileToDisk: false }
      }
    },
    renderTopRightUI: () => null
  }, customMenu);
}

const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(React.createElement(App));
