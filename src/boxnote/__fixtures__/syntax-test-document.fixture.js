const authorMark = {
  type: 'author_id',
  attrs: { authorId: '14129559' },
};

function textNode(text, marks = []) {
  return {
    type: 'text',
    text,
    marks: [authorMark, ...marks],
  };
}

export const syntaxTestDocumentFixture = {
  schema_version: 1,
  version: 56,
  doc: {
    type: 'doc',
    content: [
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [textNode('Text Formatting')],
      },
      {
        type: 'heading',
        attrs: { level: 3 },
        content: [textNode('Basic Inline Styles')],
      },
      {
        type: 'bullet_list',
        content: [
          {
            type: 'list_item',
            content: [
              {
                type: 'paragraph',
                content: [textNode('Bold Text', [{ type: 'strong' }])],
              },
            ],
          },
          {
            type: 'list_item',
            content: [
              {
                type: 'paragraph',
                content: [textNode('Italic Text', [{ type: 'em' }])],
              },
            ],
          },
          {
            type: 'list_item',
            content: [
              {
                type: 'paragraph',
                content: [textNode('Strikethrough', [{ type: 'strikethrough' }])],
              },
            ],
          },
          {
            type: 'list_item',
            content: [
              {
                type: 'paragraph',
                content: [textNode('Inline code', [{ type: 'code' }])],
              },
            ],
          },
        ],
      },
      {
        type: 'heading',
        attrs: { level: 3 },
        content: [textNode('Task Lists')],
      },
      {
        type: 'bullet_list',
        content: [
          {
            type: 'list_item',
            content: [
              {
                type: 'paragraph',
                content: [textNode('[ ] Incomplete task')],
              },
            ],
          },
          {
            type: 'list_item',
            content: [
              {
                type: 'paragraph',
                content: [textNode('[x] Completed task')],
              },
            ],
          },
          {
            type: 'list_item',
            content: [
              {
                type: 'paragraph',
                content: [
                  textNode('[ ] Another task with '),
                  textNode('emphasis', [{ type: 'em' }]),
                ],
              },
            ],
          },
          {
            type: 'list_item',
            content: [
              {
                type: 'paragraph',
                content: [
                  textNode('[x] '),
                  textNode('Completed with strikethrough', [{ type: 'strikethrough' }]),
                ],
              },
            ],
          },
        ],
      },
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [textNode('Complex Nesting Tests')],
      },
      {
        type: 'paragraph',
        content: [
          textNode('This paragraph has '),
          textNode('bold', [{ type: 'strong' }]),
          textNode(', '),
          textNode('italic', [{ type: 'em' }]),
          textNode(', emphasis, '),
          textNode('strikethrough', [{ type: 'strikethrough' }]),
          textNode(', and '),
          textNode('code', [{ type: 'code' }]),
          textNode(' all together.'),
        ],
      },
      {
        type: 'paragraph',
        content: [
          textNode('This is '),
          textNode('emphasis with strikethrough nested', [
            { type: 'strong' },
            { type: 'em' },
            { type: 'strikethrough' },
          ]),
          textNode('.'),
        ],
      },
    ],
  },
  comments: [],
  annotations: [],
};
