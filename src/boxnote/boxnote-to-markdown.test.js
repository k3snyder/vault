/**
 * @jest-environment jsdom
 */

import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { syntaxTestDocumentFixture } from './__fixtures__/syntax-test-document.fixture.js';

const mockInvoke = jest.fn();

jest.unstable_mockModule('@tauri-apps/api/core', () => ({
  invoke: mockInvoke,
}));

const { boxNoteToMarkdown, convertBoxNoteFile } = await import('./boxnote-to-markdown.js');

const sampleDoc = {
  type: 'doc',
  content: [
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'Weekly Review' }],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Check ' },
        {
          type: 'text',
          text: 'links',
          marks: [{ type: 'link', attrs: { href: 'https://example.com' } }],
        },
        { type: 'text', text: ' and ' },
        {
          type: 'text',
          text: 'formatting',
          marks: [{ type: 'strong' }],
        },
      ],
    },
    {
      type: 'check_list',
      content: [
        {
          type: 'check_list_item',
          attrs: { checked: true },
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Done task' }],
            },
          ],
        },
      ],
    },
    {
      type: 'table',
      content: [
        {
          type: 'table_row',
          content: [
            { type: 'table_cell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }] }] },
            { type: 'table_cell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'B' }] }] },
          ],
        },
        {
          type: 'table_row',
          content: [
            { type: 'table_cell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '1' }] }] },
            { type: 'table_cell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '2' }] }] },
          ],
        },
      ],
    },
  ],
};

describe('boxnote-to-markdown', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    window.openFile = jest.fn().mockResolvedValue(undefined);
    window.refreshFileTree = jest.fn();
    window.showNotification = jest.fn();
  });

  it('converts common Box nodes to markdown', () => {
    const markdown = boxNoteToMarkdown(sampleDoc);

    expect(markdown).toContain('## Weekly Review');
    expect(markdown).toContain('Check [links](https://example.com) and **formatting**');
    expect(markdown).toContain('- [x] Done task');
    expect(markdown).toContain('| A | B |');
    expect(markdown).toContain('| --- | --- |');
  });

  it('preserves markdown-authored Box paragraphs instead of escaping their syntax', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: '# ' },
            {
              type: 'text',
              text: 'Imported Title',
              marks: [{ type: 'strong' }],
            },
          ],
        },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: '**' },
            {
              type: 'text',
              text: 'Important',
              marks: [{ type: 'strong' }],
            },
            { type: 'text', text: ' details** and **more** context' },
          ],
        },
      ],
    };

    const markdown = boxNoteToMarkdown(doc);

    expect(markdown).toContain('# Imported Title');
    expect(markdown).toContain('**Important details** and **more** context');
    expect(markdown).not.toContain('\\*\\*');
  });

  it('converts syntax-test fixture content into Vault-friendly markdown', () => {
    const markdown = boxNoteToMarkdown(syntaxTestDocumentFixture.doc);

    expect(markdown).toContain('## Text Formatting');
    expect(markdown).toContain('- **Bold Text**');
    expect(markdown).toContain('- *Italic Text*');
    expect(markdown).toContain('- ~~Strikethrough~~');
    expect(markdown).toContain('- `Inline code`');
    expect(markdown).toContain('- [ ] Incomplete task');
    expect(markdown).toContain('- [x] Completed task');
    expect(markdown).toContain('- [ ] Another task with *emphasis*');
    expect(markdown).toContain('- [x] ~~Completed with strikethrough~~');
    expect(markdown).toContain('This paragraph has **bold**, *italic*, emphasis, ~~strikethrough~~, and `code` all together.');
    expect(markdown).toContain('This is ~~***emphasis with strikethrough nested***~~.');
    expect(markdown).not.toContain('\\[ \\]');
    expect(markdown).not.toContain('\\[x\\]');
  });

  it('converts native Box highlight marks into Vault ==highlight== syntax', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Highlighted guidance',
              marks: [{ type: 'highlight', attrs: { color: '#fdf0d1' } }],
            },
          ],
        },
      ],
    };

    const markdown = boxNoteToMarkdown(doc);

    expect(markdown).toContain('==Highlighted guidance==');
  });

  it('converts Box textStyle background highlights into Vault ==highlight== syntax', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Keep ' },
            {
              type: 'text',
              text: 'this highlighted',
              marks: [{ type: 'textStyle', attrs: { backgroundColor: '#fdf0d1' } }],
            },
            { type: 'text', text: ' in markdown.' },
          ],
        },
      ],
    };

    const markdown = boxNoteToMarkdown(doc);

    expect(markdown).toContain('Keep ==this highlighted== in markdown.');
  });

  it('writes a converted markdown file next to the original note', async () => {
    mockInvoke.mockImplementation(async (command, args) => {
      if (command === 'read_file_content') {
        return JSON.stringify({
          schema_version: 1,
          version: 8,
          doc: sampleDoc,
          comments: [],
          annotations: [],
        });
      }

      if (command === 'file_exists') {
        return args.filePath === 'Weekly Review.md';
      }

      if (command === 'write_file_content') {
        return null;
      }

      throw new Error(`Unexpected command: ${command}`);
    });

    const outputPath = await convertBoxNoteFile('Weekly Review.boxnote');
    const writeCall = mockInvoke.mock.calls.find(([command]) => command === 'write_file_content');

    expect(outputPath).toBe('Weekly Review (from Box Note).md');
    expect(writeCall).toBeDefined();
    expect(writeCall[1].filePath).toBe('Weekly Review (from Box Note).md');
    expect(writeCall[1].content).toContain('converted_from: "Weekly Review.boxnote"');
    expect(writeCall[1].content).toMatch(/^---\nid: [0-9a-f-]+\ncreated_at: .*?\nupdated_at: .*?\nconverted_from: "Weekly Review\.boxnote"\n---\n## Weekly Review/m);
    expect(window.openFile).toHaveBeenCalledWith('Weekly Review (from Box Note).md');
    expect(window.refreshFileTree).toHaveBeenCalled();
    expect(window.showNotification).toHaveBeenCalledWith('Converted to Weekly Review (from Box Note).md', 'success');
  });
});
