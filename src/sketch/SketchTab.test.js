import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { JSDOM } from 'jsdom';

let SketchTab;
let invoke;

function setupDom() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  global.window = dom.window;
  global.document = dom.window.document;
  global.HTMLElement = dom.window.HTMLElement;
  global.MutationObserver = dom.window.MutationObserver;
  return dom;
}

describe('SketchTab dirty tracking', () => {
  beforeEach(async () => {
    jest.resetModules();
    setupDom();

    jest.unstable_mockModule('@tauri-apps/plugin-dialog', () => ({
      save: jest.fn()
    }));

    jest.unstable_mockModule('@tauri-apps/plugin-clipboard-manager', () => ({
      writeImage: jest.fn()
    }));

    ({ invoke } = await import('@tauri-apps/api/core'));
    invoke.mockReset();
    invoke.mockResolvedValue(null);

    ({ SketchTab } = await import('./SketchTab.js'));
  });

  test('does not re-mark a sketch dirty when a delayed change matches the just-saved scene', async () => {
    const tabManager = {
      tabs: new Map([['tab-1', { id: 'tab-1', isDirty: true }]]),
      emit: jest.fn()
    };
    const frameWindow = { postMessage: jest.fn() };
    const savedScene = JSON.stringify({
      type: 'excalidraw',
      version: 2,
      source: 'vault-desktop',
      elements: [{ id: 'shape-1' }],
      appState: {
        theme: 'light',
        viewBackgroundColor: '#ffffff'
      },
      files: {}
    });

    const sketchTab = new SketchTab('Sketches/Test2.excalidraw', tabManager, 'pane-1');
    sketchTab.tabId = 'tab-1';
    sketchTab.toolbar = document.createElement('div');
    sketchTab.toolbar.innerHTML = '<span class="sketch-dirty-indicator" style="display: none;"></span>';
    sketchTab.iframe = document.createElement('iframe');
    Object.defineProperty(sketchTab.iframe, 'contentWindow', {
      value: frameWindow,
      configurable: true
    });
    sketchTab.setupMessageHandler();
    sketchTab.isReady = true;
    sketchTab.setDirty(true);

    const savePromise = sketchTab.save();

    window.dispatchEvent(new window.MessageEvent('message', {
      data: { type: 'sceneData', data: savedScene },
      source: frameWindow
    }));

    await savePromise;

    expect(invoke).toHaveBeenCalledWith('write_file_content', {
      filePath: 'Sketches/Test2.excalidraw',
      content: savedScene
    });
    expect(sketchTab.isDirty).toBe(false);

    window.dispatchEvent(new window.MessageEvent('message', {
      data: { type: 'change', data: JSON.parse(savedScene) },
      source: frameWindow
    }));

    expect(sketchTab.isDirty).toBe(false);
    expect(tabManager.tabs.get('tab-1').isDirty).toBe(false);

    sketchTab.destroy();
  });
});
