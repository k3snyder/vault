import { jest } from '@jest/globals';
import {
  applyLineNavigation,
  createPendingLineNavigation,
  takeMatchingLineNavigation
} from './file-line-navigation.js';

describe('file-line-navigation', () => {
  test('creates pending navigation only for valid file and line', () => {
    expect(createPendingLineNavigation('/vault/note.md', 12)).toEqual({
      filePath: '/vault/note.md',
      lineNumber: 12
    });
    expect(createPendingLineNavigation('/vault/note.md', 0)).toBeNull();
    expect(createPendingLineNavigation('', 12)).toBeNull();
  });

  test('consumes pending navigation only for matching file', () => {
    const pending = createPendingLineNavigation('/vault/note.md', 24);

    expect(takeMatchingLineNavigation(pending, '/vault/other.md')).toEqual({
      nextRequest: pending,
      lineNumber: null
    });

    expect(takeMatchingLineNavigation(pending, '/vault/note.md')).toEqual({
      nextRequest: null,
      lineNumber: 24
    });
  });

  test('applies navigation using the loaded document line map', () => {
    const dispatch = jest.fn();
    const focus = jest.fn();
    const line = jest.fn((number) => ({ from: number * 100 }));
    const editor = {
      view: {
        state: {
          doc: {
            lines: 8,
            line
          }
        },
        dispatch,
        focus
      }
    };

    expect(applyLineNavigation(editor, 12)).toBe(true);
    expect(line).toHaveBeenCalledWith(8);
    expect(dispatch).toHaveBeenCalledWith({
      selection: { anchor: 800 },
      scrollIntoView: true
    });
    expect(focus).toHaveBeenCalled();
  });

  test('returns false when editor view is unavailable', () => {
    expect(applyLineNavigation(null, 10)).toBe(false);
    expect(applyLineNavigation({ view: null }, 10)).toBe(false);
  });
});
