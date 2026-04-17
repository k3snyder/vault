import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { JSDOM } from 'jsdom';

let VaultPicker;
let invoke;
let windowContextMock;

function setupDom() {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>');
  global.window = dom.window;
  global.document = dom.window.document;
  global.HTMLElement = dom.window.HTMLElement;
}

async function flushAsyncWork() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('VaultPicker', () => {
  beforeEach(async () => {
    jest.resetModules();
    setupDom();

    windowContextMock = {
      on: jest.fn(),
      off: jest.fn(),
      getVaultInfo: jest.fn().mockResolvedValue({
        path: '/vault/test-vault',
        name: 'test-vault'
      }),
      switchVault: jest.fn().mockResolvedValue(undefined)
    };

    jest.unstable_mockModule('../contexts/WindowContext.js', () => ({
      default: windowContextMock
    }));

    jest.unstable_mockModule('../icons/icon-utils.js', () => ({
      icons: new Proxy({}, {
        get: () => () => '<svg></svg>'
      })
    }));

    ({ invoke } = await import('@tauri-apps/api/core'));
    invoke.mockReset();
    invoke.mockImplementation((command) => {
      if (command === 'get_recent_vaults_basic') {
        return Promise.resolve([
          { name: 'test-vault', path: '/vault/test-vault' },
          { name: 'pacasdb', path: '/vault/pacasdb' }
        ]);
      }

      return Promise.resolve(null);
    });

    ({ VaultPicker } = await import('./VaultPicker.js'));
  });

  test('supports multiple scoped picker instances on the same page', async () => {
    const sidebarContainer = document.createElement('div');
    const welcomeContainer = document.createElement('div');
    document.body.appendChild(sidebarContainer);
    document.body.appendChild(welcomeContainer);

    const sidebarPicker = new VaultPicker(sidebarContainer);
    const welcomePicker = new VaultPicker(welcomeContainer, {
      variant: 'hero',
      enableKeyboardShortcut: false,
      showIcon: false,
      emptyLabel: 'Select your vault'
    });

    await flushAsyncWork();

    expect(sidebarContainer.querySelector('.vault-picker')).toBeTruthy();
    expect(welcomeContainer.querySelector('.vault-picker--hero')).toBeTruthy();

    sidebarContainer.querySelector('.vault-picker-button').dispatchEvent(
      new window.MouseEvent('click', { bubbles: true })
    );

    expect(sidebarContainer.querySelector('.vault-picker-menu').classList.contains('open')).toBe(true);
    expect(sidebarContainer.querySelector('.vault-picker-button').getAttribute('aria-expanded')).toBe('true');
    expect(welcomeContainer.querySelector('.vault-picker-menu').classList.contains('open')).toBe(false);

    document.body.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

    expect(sidebarContainer.querySelector('.vault-picker-menu').classList.contains('open')).toBe(false);
    expect(sidebarContainer.querySelector('.vault-picker-button').getAttribute('aria-expanded')).toBe('false');

    sidebarPicker.destroy();
    welcomePicker.destroy();
  });
});
