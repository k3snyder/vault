import { describe, expect, it } from '@jest/globals';
import {
  extractBoxNotePlainText,
  parseBoxNoteFileContent,
  renderBoxNoteToHtml,
} from './boxnote-adapter.js';
import { syntaxTestDocumentFixture } from './__fixtures__/syntax-test-document.fixture.js';

const sampleNote = {
  schema_version: 1,
  version: 7,
  doc: {
    type: 'doc',
    content: [
      {
        type: 'heading',
        attrs: { level: 1 },
        content: [{ type: 'text', text: 'Launch Notes' }],
      },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Read ' },
          {
            type: 'text',
            text: 'this',
            marks: [
              { type: 'strong' },
              { type: 'link', attrs: { href: 'https://example.com' } },
            ],
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
                content: [{ type: 'text', text: 'Ship it' }],
              },
            ],
          },
        ],
      },
      {
        type: 'callout',
        attrs: { type: 'warning' },
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Review access first' }],
          },
        ],
      },
    ],
  },
  comments: [],
  annotations: [],
};

describe('boxnote-adapter', () => {
  it('parses post-2022 notes and reports unsupported content', () => {
    const parsed = parseBoxNoteFileContent(JSON.stringify({
      ...sampleNote,
      doc: {
        ...sampleNote.doc,
        content: [
          ...sampleNote.doc.content,
          {
            type: 'mystery_block',
            content: [
              {
                type: 'paragraph',
                content: [
                  {
                    type: 'text',
                    text: 'Hidden',
                    marks: [{ type: 'mystery_mark' }],
                  },
                ],
              },
            ],
          },
        ],
      },
    }));

    expect(parsed.boxNote.schema_version).toBe(1);
    expect(parsed.doc.type).toBe('doc');
    expect(parsed.hasUnsupportedContent).toBe(true);
    expect(parsed.unsupportedNodes).toContain('mystery_block');
    expect(parsed.unsupportedMarks).toContain('mystery_mark');
  });

  it('rejects classic notes', () => {
    expect(() => parseBoxNoteFileContent(JSON.stringify({
      atext: { text: 'legacy' },
    }))).toThrow('Classic pre-2022 Box Notes are not supported in Vault yet.');
  });

  it('renders note content to HTML', () => {
    const html = renderBoxNoteToHtml(sampleNote.doc);

    expect(html).toContain('<h1>Launch Notes</h1>');
    expect(html).toContain('<a href="https://example.com"');
    expect(html).toContain('<strong>this</strong>');
    expect(html).toContain('boxnote-checklist');
    expect(html).toContain('boxnote-callout-warning');
  });

  it('extracts readable plain text', () => {
    const text = extractBoxNotePlainText(sampleNote.doc);

    expect(text).toContain('Launch Notes');
    expect(text).toContain('Read this');
    expect(text).toContain('Ship it');
    expect(text).toContain('Review access first');
  });

  it('treats Box strikethrough marks from the syntax test fixture as supported content', () => {
    const parsed = parseBoxNoteFileContent(JSON.stringify(syntaxTestDocumentFixture));
    const html = renderBoxNoteToHtml(parsed.doc);

    expect(parsed.hasUnsupportedContent).toBe(false);
    expect(parsed.unsupportedMarks).toEqual([]);
    expect(html).toContain('<s>Strikethrough</s>');
    expect(html).toContain('<s><em><strong>emphasis with strikethrough nested</strong></em></s>');
  });

  it('treats native Box highlight marks as supported content and renders their color', () => {
    const highlightedNote = {
      ...sampleNote,
      doc: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'Highlighted summary',
                marks: [{ type: 'highlight', attrs: { color: '#fdf0d1' } }],
              },
            ],
          },
        ],
      },
    };

    const parsed = parseBoxNoteFileContent(JSON.stringify(highlightedNote));
    const html = renderBoxNoteToHtml(parsed.doc);

    expect(parsed.hasUnsupportedContent).toBe(false);
    expect(parsed.unsupportedMarks).toEqual([]);
    expect(html).toContain('<mark class="boxnote-highlight"');
    expect(html).toContain('background-color: #fdf0d1;');
    expect(html).toContain('Highlighted summary');
  });
});
