import { jest } from '@jest/globals';

const invoke = jest.fn();
const extractTags = jest.fn(() => []);

jest.unstable_mockModule('@tauri-apps/api/core', () => ({
  invoke,
}));

jest.unstable_mockModule('../editor/markdown-extensions.js', () => ({
  markdownUtils: {
    extractTags,
  },
}));

let tagContextExpander;

beforeAll(async () => {
  ({ tagContextExpander } = await import('./TagContextExpander.js'));
});

beforeEach(() => {
  invoke.mockReset();
  extractTags.mockReset();
  extractTags.mockReturnValue([]);
  tagContextExpander.setEnabled(true);
});

describe('TagContextExpander', () => {
  test('searches tags via agent_notes_by_tag and deduplicates note paths', async () => {
    invoke.mockImplementation(async (command, args) => {
      if (command !== 'agent_notes_by_tag') {
        throw new Error(`Unexpected command: ${command}`);
      }

      if (args.tag === 'project') {
        return [
          { path: 'Projects/Alpha.md', title: 'Alpha' },
          { path: 'Shared/Overview.md', title: 'Overview' },
        ];
      }

      if (args.tag === 'client') {
        return [
          { path: 'Shared/Overview.md', title: 'Overview' },
        ];
      }

      return [];
    });

    const results = await tagContextExpander.searchTaggedNotes([
      { tag: 'project' },
      { tag: 'client' },
    ]);

    expect(invoke).toHaveBeenNthCalledWith(1, 'agent_notes_by_tag', {
      tag: 'project',
      limit: 20,
    });
    expect(invoke).toHaveBeenNthCalledWith(2, 'agent_notes_by_tag', {
      tag: 'client',
      limit: 20,
    });
    expect(results).toEqual([
      {
        file: 'Projects/Alpha.md',
        path: 'Projects/Alpha.md',
        title: 'Alpha',
        tags: ['project'],
      },
      {
        file: 'Shared/Overview.md',
        path: 'Shared/Overview.md',
        title: 'Overview',
        tags: ['project', 'client'],
      },
    ]);
  });
});
