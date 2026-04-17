/**
 * @jest-environment jsdom
 */
import { jest } from '@jest/globals';

const settingsIcon = jest.fn(() => '<svg data-icon="settings"></svg>');
const checkCircleIcon = jest.fn(() => '<svg data-icon="check-circle"></svg>');
const alertCircleIcon = jest.fn(() => '<svg data-icon="alert-circle"></svg>');
const clockIcon = jest.fn(() => '<svg data-icon="clock"></svg>');
const chevronDownIcon = jest.fn(() => '<svg data-icon="chevron-down"></svg>');

jest.unstable_mockModule('../icons/icon-utils.js', () => ({
  icons: {
    settings: settingsIcon,
    checkCircle: checkCircleIcon,
    alertCircle: alertCircleIcon,
    clock: clockIcon,
    chevronDown: chevronDownIcon,
  },
}));

let ToolUseCard;

beforeAll(async () => {
  ({ ToolUseCard } = await import('./ToolUseCard.js'));
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('ToolUseCard', () => {
  test('falls back to the settings icon for unknown tool names', () => {
    const card = new ToolUseCard({
      id: 'tool-1',
      toolName: 'unknown_tool',
      toolInput: {},
      status: 'running',
    });

    expect(settingsIcon).toHaveBeenCalled();
    expect(card.getElement().innerHTML).toContain('data-icon="settings"');
  });

  test('uses alert-circle for error status without requiring xCircle', () => {
    const card = new ToolUseCard({
      id: 'tool-2',
      toolName: 'botcky_event',
      toolInput: {},
      status: 'error',
    });

    expect(alertCircleIcon).toHaveBeenCalled();
    expect(card.getElement().innerHTML).toContain('data-icon="alert-circle"');
  });
});
