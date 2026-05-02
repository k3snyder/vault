import React from 'react';

export function BotckyMarkdown({ content }) {
  return React.createElement(
    'div',
    { className: 'botcky-markdown' },
    renderMarkdownBlocks(normalizeText(content)),
  );
}

export function renderMarkdownBlocks(markdown) {
  const lines = normalizeCommonModelMarkdown(markdown).split(/\r?\n/);
  const blocks = [];
  let index = 0;
  let key = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (line.startsWith('```')) {
      const language = line.slice(3).trim().replace(/[^\w-]/g, '') || 'plaintext';
      const codeLines = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith('```')) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push(React.createElement('pre', { key: key++, className: 'botcky-code-block' },
        React.createElement('code', { className: `language-${language}` }, codeLines.join('\n')),
      ));
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      blocks.push(React.createElement(`h${level}`, { key: key++ }, renderInlineMarkdown(heading[2], `h-${key}`)));
      index += 1;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quoteLines = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^>\s?/, ''));
        index += 1;
      }
      blocks.push(React.createElement('blockquote', { key: key++ }, renderInlineMarkdown(quoteLines.join('\n'), `q-${key}`)));
      continue;
    }

    if (isUnorderedListLine(line)) {
      const items = [];
      while (index < lines.length && isUnorderedListLine(lines[index])) {
        const item = lines[index].replace(/^\s{0,3}[-*]\s+/, '');
        items.push(React.createElement('li', { key: items.length }, renderInlineMarkdown(item, `ul-${key}-${items.length}`)));
        index += 1;
      }
      blocks.push(React.createElement('ul', { key: key++ }, items));
      continue;
    }

    if (isOrderedListLine(line)) {
      const items = [];
      while (index < lines.length && isOrderedListLine(lines[index])) {
        const item = lines[index].replace(/^\s{0,3}\d+\.\s+/, '');
        items.push(React.createElement('li', { key: items.length }, renderInlineMarkdown(item, `ol-${key}-${items.length}`)));
        index += 1;
      }
      blocks.push(React.createElement('ol', { key: key++ }, items));
      continue;
    }

    const paragraphLines = [];
    while (
      index < lines.length &&
      lines[index].trim() &&
      !lines[index].startsWith('```') &&
      !/^(#{1,6})\s+/.test(lines[index]) &&
      !/^>\s?/.test(lines[index]) &&
      !isUnorderedListLine(lines[index]) &&
      !isOrderedListLine(lines[index])
    ) {
      paragraphLines.push(lines[index]);
      index += 1;
    }

    blocks.push(React.createElement('p', { key: key++ },
      paragraphLines.flatMap((paragraphLine, lineIndex) => {
        const inline = renderInlineMarkdown(paragraphLine, `p-${key}-${lineIndex}`);
        return lineIndex === 0 ? inline : [React.createElement('br', { key: `br-${lineIndex}` }), ...inline];
      }),
    ));
  }

  return blocks;
}

function normalizeCommonModelMarkdown(markdown) {
  const value = normalizeText(markdown);
  const lines = value.split(/\r?\n/);
  const oneMarkers = lines.filter(line => /^\s{0,3}1\.\s+/.test(line)).length;
  const otherNumberMarkers = lines.filter(line => /^\s{0,3}(?:[2-9]|\d{2,})\.\s+/.test(line)).length;

  if (oneMarkers < 2 || otherNumberMarkers > 0) {
    return value;
  }

  return lines
    .map(line => line.replace(/^(\s{0,3})1\.\s+/, '$1- '))
    .join('\n');
}

function isUnorderedListLine(line) {
  return /^\s{0,3}[-*]\s+/.test(line);
}

function isOrderedListLine(line) {
  return /^\s{0,3}\d+\.\s+/.test(line);
}

export function renderInlineMarkdown(text, keyPrefix = 'inline') {
  const value = normalizeText(text);
  if (!value) return [];

  const nodes = [];
  const tokenPattern = /`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)|(\*\*|__)(.+?)\4|(\*|_)([^*_]+?)\6|(https?:\/\/[^\s<>()]+)/g;
  let lastIndex = 0;
  let tokenIndex = 0;
  let match;

  while ((match = tokenPattern.exec(value)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(...textNodesWithBreaks(value.slice(lastIndex, match.index), `${keyPrefix}-t-${tokenIndex}`));
    }

    if (match[1] !== undefined) {
      nodes.push(React.createElement('code', { key: `${keyPrefix}-code-${tokenIndex}`, className: 'botcky-inline-code' }, match[1]));
    } else if (match[2] !== undefined) {
      const label = match[2];
      const href = match[3];
      if (isSafeLinkHref(href)) {
        nodes.push(React.createElement('a', {
          key: `${keyPrefix}-a-${tokenIndex}`,
          href: href.trim(),
          target: '_blank',
          rel: 'noopener noreferrer',
        }, label));
      } else {
        nodes.push(label);
      }
    } else if (match[5] !== undefined) {
      nodes.push(React.createElement('strong', { key: `${keyPrefix}-strong-${tokenIndex}` },
        renderInlineMarkdown(match[5], `${keyPrefix}-strong-${tokenIndex}`),
      ));
    } else if (match[7] !== undefined) {
      nodes.push(React.createElement('em', { key: `${keyPrefix}-em-${tokenIndex}` },
        renderInlineMarkdown(match[7], `${keyPrefix}-em-${tokenIndex}`),
      ));
    } else if (match[8] !== undefined) {
      const href = match[8];
      nodes.push(React.createElement('a', {
        key: `${keyPrefix}-url-${tokenIndex}`,
        href,
        target: '_blank',
        rel: 'noopener noreferrer',
      }, href));
    }

    lastIndex = tokenPattern.lastIndex;
    tokenIndex += 1;
  }

  if (lastIndex < value.length) {
    nodes.push(...textNodesWithBreaks(value.slice(lastIndex), `${keyPrefix}-t-tail`));
  }

  return nodes;
}

function textNodesWithBreaks(text, keyPrefix) {
  return normalizeText(text).split(/\r?\n/).flatMap((part, index) => (
    index === 0 ? [part] : [React.createElement('br', { key: `${keyPrefix}-br-${index}` }), part]
  ));
}

function isSafeLinkHref(href) {
  const value = normalizeText(href).trim();
  if (!value) return false;
  return /^(https?:|mailto:|tel:)/i.test(value) || /^([/#]|\.{1,2}\/)/.test(value);
}

function normalizeText(value) {
  if (value === null || value === undefined) return '';
  return typeof value === 'string' ? value : String(value);
}
