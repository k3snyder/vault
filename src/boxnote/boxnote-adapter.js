export const KNOWN_BOX_NODE_TYPES = new Set([
  'doc',
  'paragraph',
  'heading',
  'text',
  'hard_break',
  'horizontal_rule',
  'code_block',
  'blockquote',
  'bullet_list',
  'ordered_list',
  'check_list',
  'tab_list',
  'list_item',
  'check_list_item',
  'table',
  'table_row',
  'table_cell',
  'table_header',
  'image',
  'callout',
  'embed',
]);

export const KNOWN_BOX_MARK_TYPES = new Set([
  'strong',
  'bold',
  'em',
  'italic',
  'underline',
  'strike',
  'strikethrough',
  'highlight',
  'code',
  'link',
  'textStyle',
  'author_id',
]);

export function stripBom(content = '') {
  return String(content).replace(/^\uFEFF/u, '');
}

export function deriveBoxNoteTitle(fileName = 'Untitled.boxnote') {
  return String(fileName)
    .split('/')
    .pop()
    .replace(/\.boxnote$/iu, '')
    .trim() || 'Untitled';
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&#39;');
}

function escapeAttribute(value = '') {
  return escapeHtml(value);
}

function sanitizeStyleValue(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed || /[\n\r;"'<>]/u.test(trimmed)) {
    return null;
  }

  return trimmed;
}

function buildTextStyle(mark) {
  const attrs = mark?.attrs || {};
  const styleParts = [];

  const color = sanitizeStyleValue(attrs.color);
  if (color) {
    styleParts.push(`color: ${color}`);
  }

  const fontSize = sanitizeStyleValue(attrs.fontSize);
  if (fontSize) {
    styleParts.push(`font-size: ${fontSize}`);
  }

  const backgroundColor = sanitizeStyleValue(attrs.backgroundColor);
  if (backgroundColor) {
    styleParts.push(`background-color: ${backgroundColor}`);
  }

  return styleParts.join('; ');
}

function buildHighlightStyle(mark) {
  const color = sanitizeStyleValue(mark?.attrs?.color);
  return color ? `background-color: ${color};` : '';
}

function collectUnsupportedContent(node, report) {
  if (!node || typeof node !== 'object') {
    return;
  }

  if (typeof node.type === 'string' && !KNOWN_BOX_NODE_TYPES.has(node.type)) {
    report.unsupportedNodes.add(node.type);
  }

  if (Array.isArray(node.marks)) {
    node.marks.forEach((mark) => {
      if (mark?.type && !KNOWN_BOX_MARK_TYPES.has(mark.type)) {
        report.unsupportedMarks.add(mark.type);
      }
    });
  }

  if (Array.isArray(node.content)) {
    node.content.forEach((child) => collectUnsupportedContent(child, report));
  }
}

function getNodeTextContent(node) {
  if (!node || typeof node !== 'object') {
    return '';
  }

  switch (node.type) {
    case 'text':
      return node.text || '';
    case 'hard_break':
      return '\n';
    case 'paragraph':
    case 'heading':
      return `${(node.content || []).map(getNodeTextContent).join('')}\n`;
    case 'list_item':
    case 'check_list_item':
      return `${(node.content || []).map(getNodeTextContent).join('')}\n`;
    case 'bullet_list':
    case 'ordered_list':
    case 'check_list':
    case 'tab_list':
    case 'blockquote':
    case 'table':
    case 'table_row':
    case 'table_cell':
    case 'table_header':
    case 'callout':
    case 'doc':
      return (node.content || []).map(getNodeTextContent).join('');
    case 'horizontal_rule':
      return '\n---\n';
    case 'code_block':
      return `${(node.content || []).map(getNodeTextContent).join('')}\n`;
    case 'image':
      return node.attrs?.alt || '';
    case 'embed':
      return node.attrs?.url || 'Embedded content';
    default:
      return (node.content || []).map(getNodeTextContent).join('');
  }
}

function renderChildren(node) {
  return Array.isArray(node?.content) ? node.content.map(renderNode).join('') : '';
}

function applyMarks(text, marks = []) {
  return [...marks].reduce((html, mark) => {
    switch (mark?.type) {
      case 'strong':
      case 'bold':
        return `<strong>${html}</strong>`;
      case 'em':
      case 'italic':
        return `<em>${html}</em>`;
      case 'underline':
        return `<u>${html}</u>`;
      case 'strike':
      case 'strikethrough':
        return `<s>${html}</s>`;
      case 'highlight': {
        const style = buildHighlightStyle(mark);
        const styleAttr = style ? ` style="${escapeAttribute(style)}"` : '';
        return `<mark class="boxnote-highlight"${styleAttr}>${html}</mark>`;
      }
      case 'code':
        return `<code>${html}</code>`;
      case 'link': {
        const href = mark.attrs?.href ? escapeAttribute(mark.attrs.href) : '';
        if (!href) {
          return html;
        }
        const title = mark.attrs?.title ? ` title="${escapeAttribute(mark.attrs.title)}"` : '';
        return `<a href="${href}"${title} target="_blank" rel="noopener noreferrer">${html}</a>`;
      }
      case 'textStyle': {
        const style = buildTextStyle(mark);
        return style ? `<span style="${escapeAttribute(style)}">${html}</span>` : html;
      }
      case 'author_id':
        return html;
      default:
        return html;
    }
  }, text);
}

function renderTableCell(tagName, node) {
  const attrs = node?.attrs || {};
  const extraAttrs = [];

  if (Number.isInteger(attrs.colspan) && attrs.colspan > 1) {
    extraAttrs.push(` colspan="${attrs.colspan}"`);
  }

  if (Number.isInteger(attrs.rowspan) && attrs.rowspan > 1) {
    extraAttrs.push(` rowspan="${attrs.rowspan}"`);
  }

  return `<${tagName}${extraAttrs.join('')}>${renderChildren(node)}</${tagName}>`;
}

function renderNode(node) {
  if (!node || typeof node !== 'object') {
    return '';
  }

  switch (node.type) {
    case 'doc':
      return renderChildren(node);
    case 'paragraph': {
      const content = renderChildren(node);
      return content ? `<p>${content}</p>` : '<p><br></p>';
    }
    case 'heading': {
      const rawLevel = Number(node.attrs?.level);
      const level = Number.isInteger(rawLevel) && rawLevel >= 1 && rawLevel <= 6 ? rawLevel : 1;
      return `<h${level}>${renderChildren(node)}</h${level}>`;
    }
    case 'text':
      return applyMarks(escapeHtml(node.text || ''), node.marks || []);
    case 'hard_break':
      return '<br>';
    case 'horizontal_rule':
      return '<hr>';
    case 'code_block': {
      const language = node.attrs?.language
        ? ` data-language="${escapeAttribute(node.attrs.language)}"`
        : '';
      return `<pre><code${language}>${escapeHtml(getNodeTextContent(node))}</code></pre>`;
    }
    case 'blockquote':
      return `<blockquote>${renderChildren(node)}</blockquote>`;
    case 'bullet_list':
      return `<ul>${renderChildren(node)}</ul>`;
    case 'ordered_list': {
      const start = Number(node.attrs?.start);
      const startAttr = Number.isInteger(start) && start > 1 ? ` start="${start}"` : '';
      return `<ol${startAttr}>${renderChildren(node)}</ol>`;
    }
    case 'check_list':
      return `<ul class="boxnote-checklist">${renderChildren(node)}</ul>`;
    case 'tab_list':
      return `<ul class="boxnote-tab-list">${renderChildren(node)}</ul>`;
    case 'list_item':
      return `<li>${renderChildren(node)}</li>`;
    case 'check_list_item': {
      const checked = node.attrs?.checked ? ' checked' : '';
      return `<li class="boxnote-check-item"><input type="checkbox"${checked} disabled> <span>${renderChildren(node)}</span></li>`;
    }
    case 'table':
      return `<div class="boxnote-table-wrap"><table>${renderChildren(node)}</table></div>`;
    case 'table_row':
      return `<tr>${renderChildren(node)}</tr>`;
    case 'table_cell':
      return renderTableCell('td', node);
    case 'table_header':
      return renderTableCell('th', node);
    case 'image': {
      const src = node.attrs?.src ? escapeAttribute(node.attrs.src) : '';
      if (!src) {
        return '<div class="boxnote-missing-image">[Image unavailable]</div>';
      }
      const alt = escapeAttribute(node.attrs?.alt || '');
      const title = node.attrs?.title ? ` title="${escapeAttribute(node.attrs.title)}"` : '';
      return `<figure class="boxnote-image"><img src="${src}" alt="${alt}"${title}></figure>`;
    }
    case 'callout': {
      const calloutType = sanitizeStyleValue(node.attrs?.type) || 'info';
      return `<div class="boxnote-callout boxnote-callout-${escapeAttribute(calloutType)}">${renderChildren(node)}</div>`;
    }
    case 'embed': {
      const url = node.attrs?.url || '';
      const label = url ? escapeHtml(url) : 'Embedded content';
      return `<div class="boxnote-embed">${label}</div>`;
    }
    default:
      if (Array.isArray(node.content) && node.content.length > 0) {
        return renderChildren(node);
      }
      return `<div class="boxnote-unknown">[Unsupported Box node: ${escapeHtml(node.type || 'unknown')}]</div>`;
  }
}

export function parseBoxNoteFileContent(rawContent = '') {
  const normalized = stripBom(rawContent);
  const parsed = JSON.parse(normalized || '{}');

  if (parsed.atext) {
    throw new Error('Classic pre-2022 Box Notes are not supported in Vault yet.');
  }

  if (!parsed.doc || !Array.isArray(parsed.doc.content)) {
    throw new Error('Unsupported .boxnote file: expected post-2022 Box Note JSON with doc.content.');
  }

  const report = {
    unsupportedNodes: new Set(),
    unsupportedMarks: new Set(),
  };

  collectUnsupportedContent(parsed.doc, report);

  return {
    boxNote: parsed,
    doc: parsed.doc,
    unsupportedNodes: Array.from(report.unsupportedNodes),
    unsupportedMarks: Array.from(report.unsupportedMarks),
    hasUnsupportedContent: report.unsupportedNodes.size > 0 || report.unsupportedMarks.size > 0,
  };
}

export function renderBoxNoteToHtml(doc) {
  return renderNode(doc);
}

export function extractBoxNotePlainText(doc) {
  return getNodeTextContent(doc)
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}
