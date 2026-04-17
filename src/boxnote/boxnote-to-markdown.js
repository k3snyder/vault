import { invoke } from '@tauri-apps/api/core';
import { deriveBoxNoteTitle, parseBoxNoteFileContent } from './boxnote-adapter.js';

const LIST_NODE_TYPES = new Set(['bullet_list', 'ordered_list', 'check_list', 'tab_list']);

function escapeMarkdownText(text = '') {
  return String(text)
    .replace(/\\/gu, '\\\\')
    .replace(/([*_`~[\]])/gu, '\\$1');
}

function escapeLinkDestination(url = '') {
  return String(url).replace(/[()]/gu, '\\$&');
}

function normalizeInlineWhitespace(value = '') {
  return String(value).replace(/\s+/gu, ' ').trim();
}

function inlineNodesToRawMarkdown(nodes = []) {
  return nodes.map((node) => {
    if (!node || typeof node !== 'object') {
      return '';
    }

    switch (node.type) {
      case 'text':
        return node.text || '';
      case 'hard_break':
        return '\n';
      case 'image': {
        const src = node.attrs?.src || '';
        const alt = node.attrs?.alt || '';
        return src ? `![${alt}](${src})` : '';
      }
      case 'embed':
        return `[Embedded: ${node.attrs?.url || 'content'}]`;
      default:
        return Array.isArray(node.content) ? inlineNodesToRawMarkdown(node.content) : '';
    }
  }).join('');
}

function looksLikeMarkdownAuthoredText(value = '') {
  const text = String(value || '').trim();
  if (!text) {
    return false;
  }

  if (/^(?:#{1,6}\s+\S|[-*_](?:\s*[-*_]){2,}\s*|>\s+|(?:[-+*]|\d+\.)\s+|- \[[ xX]\]\s+)/mu.test(text)) {
    return true;
  }

  if (/\*\*[^*]+?\*\*|__[^_]+?__|~~[^~]+?~~|==[^=\n]+?==|`[^`]+`|\[[^\]]+\]\([^)]+\)/u.test(text)) {
    return true;
  }

  return false;
}

function wrapWithHighlightSyntax(text = '') {
  const value = String(text);
  if (value.startsWith('==') && value.endsWith('==')) {
    return value;
  }
  return `==${value}==`;
}

function applyMarks(text, marks = []) {
  let result = text;
  const linkMarks = [];

  marks.forEach((mark) => {
    switch (mark?.type) {
      case 'strong':
      case 'bold':
        result = `**${result}**`;
        break;
      case 'em':
      case 'italic':
        result = `*${result}*`;
        break;
      case 'strike':
      case 'strikethrough':
        result = `~~${result}~~`;
        break;
      case 'highlight':
        result = wrapWithHighlightSyntax(result);
        break;
      case 'code':
        result = `\`${result}\``;
        break;
      case 'underline':
        result = `<u>${result}</u>`;
        break;
      case 'link':
        linkMarks.push(mark);
        break;
      case 'textStyle':
        if (mark?.attrs?.backgroundColor) {
          result = wrapWithHighlightSyntax(result);
        }
        break;
      case 'author_id':
      default:
        break;
    }
  });

  linkMarks.forEach((mark) => {
    const href = mark?.attrs?.href;
    if (href) {
      result = `[${result}](${escapeLinkDestination(href)})`;
    }
  });

  return result;
}

function unescapeLeadingTaskMarker(text = '') {
  return String(text).replace(/^\\\[([ xX])\\\](\s+)/u, '[$1]$2');
}

function inlineNodesToMarkdown(nodes = []) {
  return nodes.map((node) => {
    if (!node || typeof node !== 'object') {
      return '';
    }

    switch (node.type) {
      case 'text':
        return applyMarks(escapeMarkdownText(node.text || ''), node.marks || []);
      case 'hard_break':
        return '  \n';
      case 'image': {
        const src = node.attrs?.src || '';
        const alt = escapeMarkdownText(node.attrs?.alt || '');
        return src ? `![${alt}](${escapeLinkDestination(src)})` : `[Image${alt ? `: ${alt}` : ''}]`;
      }
      case 'embed':
        return `[Embedded: ${node.attrs?.url || 'content'}]`;
      default:
        return Array.isArray(node.content) ? inlineNodesToMarkdown(node.content) : '';
    }
  }).join('');
}

function prefixLines(text, prefix) {
  return text
    .split('\n')
    .map((line) => (line ? `${prefix}${line}` : prefix.trimEnd()))
    .join('\n');
}

function tableToMarkdown(node) {
  const rows = (node.content || []).filter((child) => child?.type === 'table_row');
  if (rows.length === 0) {
    return '';
  }

  const renderedRows = rows.map((row) => {
    const cells = (row.content || []).map((cell) => {
      const cellText = normalizeInlineWhitespace(inlineNodesToMarkdown(cell.content || []))
        .replace(/\|/gu, '\\|');
      return cellText || ' ';
    });
    return `| ${cells.join(' | ')} |`;
  });

  const headerCells = (rows[0].content || []).length || 1;
  const separator = `| ${Array.from({ length: headerCells }, () => '---').join(' | ')} |`;
  renderedRows.splice(1, 0, separator);

  return `${renderedRows.join('\n')}\n\n`;
}

function listItemToMarkdown(node, options) {
  const {
    indent = '',
    marker = '- ',
    orderedIndex = 1,
    ordered = false,
  } = options;

  const effectiveMarker = ordered ? `${orderedIndex}. ` : marker;
  const childIndent = `${indent}${' '.repeat(effectiveMarker.length)}`;
  const blockChildren = [];
  const nestedLists = [];

  (node.content || []).forEach((child) => {
    if (LIST_NODE_TYPES.has(child?.type)) {
      nestedLists.push(child);
    } else {
      blockChildren.push(child);
    }
  });

  const inlineContent = blockChildren
    .map((child) => nodeToMarkdown(child, { indent: childIndent, inListItem: true }))
    .join('')
    .trimEnd();
  const normalizedInlineContent = !ordered && marker === '- '
    ? unescapeLeadingTaskMarker(inlineContent)
    : inlineContent;

  const inlineLines = normalizedInlineContent ? normalizedInlineContent.split('\n') : [''];
  let output = `${indent}${effectiveMarker}${inlineLines[0] || ''}\n`;

  inlineLines.slice(1).forEach((line) => {
    output += `${childIndent}${line}\n`;
  });

  nestedLists.forEach((listNode) => {
    output += nodeToMarkdown(listNode, { indent: childIndent });
  });

  return output;
}

function listToMarkdown(node, options = {}) {
  const indent = options.indent || '';
  const start = Number.isInteger(node.attrs?.start) ? node.attrs.start : 1;
  const isOrdered = node.type === 'ordered_list';

  const output = (node.content || []).map((child, index) => {
    if (!child || (child.type !== 'list_item' && child.type !== 'check_list_item')) {
      return '';
    }

    if (node.type === 'check_list') {
      return listItemToMarkdown(child, {
        indent,
        marker: child.attrs?.checked ? '- [x] ' : '- [ ] ',
      });
    }

    if (isOrdered) {
      return listItemToMarkdown(child, {
        indent,
        ordered: true,
        orderedIndex: start + index,
      });
    }

    return listItemToMarkdown(child, {
      indent,
      marker: '- ',
    });
  }).join('');

  return `${output}${indent ? '' : '\n'}`;
}

function calloutToMarkdown(node) {
  const calloutType = String(node.attrs?.type || 'info').toUpperCase();
  const content = normalizeInlineWhitespace(
    (node.content || []).map((child) => nodeToMarkdown(child, { inCallout: true })).join('')
  );

  return `> [${calloutType}] ${content}\n\n`;
}

function codeBlockToMarkdown(node) {
  const language = node.attrs?.language || '';
  const code = (node.content || []).map((child) => child?.text || '').join('');
  return `\`\`\`${language}\n${code}\n\`\`\`\n\n`;
}

function blockquoteToMarkdown(node) {
  const content = (node.content || [])
    .map((child) => nodeToMarkdown(child, { inBlockquote: true }))
    .join('')
    .trimEnd();

  if (!content) {
    return '';
  }

  return `${prefixLines(content, '> ')}\n\n`;
}

function nodeToMarkdown(node, options = {}) {
  if (!node || typeof node !== 'object') {
    return '';
  }

  const { inListItem = false } = options;

  switch (node.type) {
    case 'doc':
      return (node.content || []).map((child) => nodeToMarkdown(child, options)).join('');
    case 'heading': {
      const level = Number.isInteger(node.attrs?.level) ? node.attrs.level : 1;
      const hashes = '#'.repeat(Math.min(Math.max(level, 1), 6));
      return `${hashes} ${inlineNodesToMarkdown(node.content || [])}\n\n`;
    }
    case 'paragraph': {
      const rawMarkdown = inlineNodesToRawMarkdown(node.content || []);
      if (looksLikeMarkdownAuthoredText(rawMarkdown)) {
        const normalizedRaw = rawMarkdown.trimEnd();
        if (inListItem) {
          return normalizedRaw;
        }
        return normalizedRaw ? `${normalizedRaw}\n\n` : '\n';
      }

      const content = inlineNodesToMarkdown(node.content || []);
      if (inListItem) {
        return content;
      }
      return content ? `${content}\n\n` : '\n';
    }
    case 'text':
      return applyMarks(escapeMarkdownText(node.text || ''), node.marks || []);
    case 'hard_break':
      return '  \n';
    case 'horizontal_rule':
      return '---\n\n';
    case 'code_block':
      return codeBlockToMarkdown(node);
    case 'blockquote':
      return blockquoteToMarkdown(node);
    case 'bullet_list':
    case 'ordered_list':
    case 'check_list':
    case 'tab_list':
      return listToMarkdown(node, options);
    case 'list_item':
    case 'check_list_item':
      return listItemToMarkdown(node, {
        indent: options.indent || '',
        marker: node.type === 'check_list_item'
          ? (node.attrs?.checked ? '- [x] ' : '- [ ] ')
          : '- ',
      });
    case 'table':
      return tableToMarkdown(node);
    case 'image': {
      const src = node.attrs?.src || '';
      const alt = escapeMarkdownText(node.attrs?.alt || '');
      return src ? `![${alt}](${escapeLinkDestination(src)})\n\n` : '';
    }
    case 'callout':
      return calloutToMarkdown(node);
    case 'embed':
      return `[Embedded: ${node.attrs?.url || 'content'}]\n\n`;
    default:
      if (Array.isArray(node.content)) {
        return node.content.map((child) => nodeToMarkdown(child, options)).join('');
      }
      return '';
  }
}

function normalizeMarkdownOutput(markdown) {
  return markdown
    .replace(/\n{3,}/gu, '\n\n')
    .trimEnd();
}

function generateUuidV7() {
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }

  const timestamp = BigInt(Date.now());
  bytes[0] = Number((timestamp >> 40n) & 0xffn);
  bytes[1] = Number((timestamp >> 32n) & 0xffn);
  bytes[2] = Number((timestamp >> 24n) & 0xffn);
  bytes[3] = Number((timestamp >> 16n) & 0xffn);
  bytes[4] = Number((timestamp >> 8n) & 0xffn);
  bytes[5] = Number(timestamp & 0xffn);
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

function buildFrontmatter(originalFilePath) {
  const now = new Date().toISOString();
  const originalFileName = String(originalFilePath).split('/').pop() || 'unknown.boxnote';

  return [
    '---',
    `id: ${generateUuidV7()}`,
    `created_at: ${now}`,
    `updated_at: ${now}`,
    `converted_from: "${originalFileName.replace(/"/gu, '\\"')}"`,
    '---',
    '',
  ].join('\n');
}

async function findAvailableMarkdownPath(originalFilePath) {
  const basePath = String(originalFilePath).replace(/\.boxnote$/iu, '');
  const candidates = [
    `${basePath}.md`,
    `${basePath} (from Box Note).md`,
  ];

  for (let suffix = 2; suffix <= 99; suffix += 1) {
    candidates.push(`${basePath} (from Box Note ${suffix}).md`);
  }

  for (const candidate of candidates) {
    const exists = await invoke('file_exists', { filePath: candidate });
    if (!exists) {
      return candidate;
    }
  }

  throw new Error('Unable to determine a unique markdown filename for this Box Note.');
}

export function boxNoteToMarkdown(doc) {
  return normalizeMarkdownOutput(nodeToMarkdown(doc));
}

export async function convertBoxNoteFile(filePath) {
  const rawContent = await invoke('read_file_content', { filePath });
  const parsed = parseBoxNoteFileContent(rawContent);
  const markdownBody = boxNoteToMarkdown(parsed.doc);
  const fileTitle = deriveBoxNoteTitle(filePath);
  const frontmatter = buildFrontmatter(filePath);
  const markdown = markdownBody
    ? `${frontmatter}${markdownBody}\n`
    : `${frontmatter}# ${fileTitle}\n`;
  const outputPath = await findAvailableMarkdownPath(filePath);

  await invoke('write_file_content', {
    filePath: outputPath,
    content: markdown,
  });

  if (typeof window !== 'undefined') {
    window.refreshFileTree?.();
    if (typeof window.openFile === 'function') {
      await window.openFile(outputPath);
    }
    window.showNotification?.(`Converted to ${outputPath.split('/').pop()}`, 'success');
  }

  return outputPath;
}
