import { JSDOM } from 'jsdom';
import { jest } from '@jest/globals';
import { invoke } from '@tauri-apps/api/core';

// Ensure fresh module state per test run
let WidgetSidebar;

function setupDom() {
  const dom = new JSDOM(`<!doctype html><html><body>
    <div class="app-container">
      <div class="editor-container"></div>
      <div class="right-sidebar"></div>
    </div>
  </body></html>`);
  global.window = dom.window;
  global.document = dom.window.document;
  global.HTMLElement = dom.window.HTMLElement;
  return dom;
}

describe('WidgetSidebar width management', () => {
  beforeEach(async () => {
    jest.resetModules();
    // Default mock: no saved settings
    invoke.mockReset();
    invoke.mockResolvedValueOnce(null);
    // dynamic import after resetting modules
    WidgetSidebar = (await import('./WidgetSidebar.js')).WidgetSidebar;
    // Provide vault path for settings I/O
    global.window.currentVaultPath = '/vault/test';
  });

  test('visible width defaults to >= 400px and clamps between 400–500px on resize', async () => {
    setupDom();
    global.window.currentVaultPath = '/vault/test';
    const sidebar = new WidgetSidebar();
    sidebar.mount(document.body);

    // Show and apply layout
    sidebar.show();
    sidebar.updateLayout();

    const widthNow = parseInt(sidebar.container.style.width || '0', 10);
    expect(widthNow).toBeGreaterThanOrEqual(400);

    // Simulate resize to below min (dragging right increases clientX → delta negative)
    const handle = sidebar.resizeHandle;
    const startX = 1000;
    handle.dispatchEvent(new window.MouseEvent('mousedown', { clientX: startX, bubbles: true }));
    document.dispatchEvent(new window.MouseEvent('mousemove', { clientX: startX + 300, bubbles: true })); // -300 → try shrink below min
    document.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true }));

    const widthAfterMinClamp = parseInt(sidebar.container.style.width, 10);
    expect(widthAfterMinClamp).toBeGreaterThanOrEqual(400);

    // Simulate resize to above max (dragging left decreases clientX → delta positive)
    handle.dispatchEvent(new window.MouseEvent('mousedown', { clientX: 1000, bubbles: true }));
    document.dispatchEvent(new window.MouseEvent('mousemove', { clientX: 300, bubbles: true })); // +700 → try exceed max
    document.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true }));

    const widthAfterMaxClamp = parseInt(sidebar.container.style.width, 10);
    expect(widthAfterMaxClamp).toBeLessThanOrEqual(500);
  });

  test('loads persisted width and saves new width after resize', async () => {
    setupDom();
    global.window.currentVaultPath = '/vault/test';
    // First invoke call: get_widget_settings → return saved settings
    invoke.mockReset();
    invoke
      .mockResolvedValueOnce({ visible: true, active_tab: 'tasks', width: 480, tab_settings: {} }) // get_widget_settings
      .mockResolvedValueOnce(null); // save_widget_settings

    const sidebar = new WidgetSidebar();
    sidebar.mount(document.body);

    // Run loadState explicitly to avoid timer flakiness
    await sidebar.loadState();

    // After loading, show and verify width is valid
    sidebar.show();
    sidebar.updateLayout();
    const loadedWidth = parseInt(sidebar.container.style.width || '0', 10);
    expect(loadedWidth).toBeGreaterThanOrEqual(400);

    // Perform a resize to trigger save
    const saveSpy = jest.spyOn(sidebar, 'saveState');
    const handle = sidebar.resizeHandle;
    handle.dispatchEvent(new window.MouseEvent('mousedown', { clientX: 1000, bubbles: true }));
    document.dispatchEvent(new window.MouseEvent('mousemove', { clientX: 400, bubbles: true }));
    document.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true }));

    // save should have been triggered and width clamped
    expect(saveSpy).toHaveBeenCalled();
    expect(sidebar.width).toBeGreaterThanOrEqual(400);
    expect(sidebar.width).toBeLessThanOrEqual(500);
  });
});
