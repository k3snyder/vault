import { syntaxTree } from '@codemirror/language'
import { RangeSetBuilder, StateEffect, StateField } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin } from '@codemirror/view'

// ============================================================================
// Syntax Markers (to hide when not editing)
// ============================================================================

/**
 * Lezer markdown node types that represent syntax markers to hide in WYSIWYG mode.
 * These are the actual markup characters users write but don't want to see when
 * not editing that specific element.
 */
const SYNTAX_MARKERS = new Set([
  'EmphasisMark',       // * or _
  'HeaderMark',         // # characters
  'CodeMark',           // ` backticks
  'LinkMark',           // [ ] ( )
  'QuoteMark',          // >
  'ListMark',           // - * + 1.
  'StrikethroughMark',  // ~~
  'HighlightMark',      // == (extended syntax)
])

// ============================================================================
// Styling Decorations
// ============================================================================

/**
 * Style decorations that add CSS classes to styled content.
 * These are applied to the content nodes (not the markers).
 *
 * Maps Lezer markdown node types to their corresponding styling decorations.
 */
const STYLE_DECORATIONS = {
  // Inline formatting
  'Emphasis': Decoration.mark({ class: 'cm-wysiwyg-italic' }),
  'StrongEmphasis': Decoration.mark({ class: 'cm-wysiwyg-bold' }),
  'InlineCode': Decoration.mark({ class: 'cm-wysiwyg-code' }),
  'Strikethrough': Decoration.mark({ class: 'cm-wysiwyg-strikethrough' }),
  'Highlight': Decoration.mark({ class: 'cm-wysiwyg-highlight' }),

  // Headings (ATXHeading1 through ATXHeading6)
  'ATXHeading1': Decoration.mark({ class: 'cm-wysiwyg-h1' }),
  'ATXHeading2': Decoration.mark({ class: 'cm-wysiwyg-h2' }),
  'ATXHeading3': Decoration.mark({ class: 'cm-wysiwyg-h3' }),
  'ATXHeading4': Decoration.mark({ class: 'cm-wysiwyg-h4' }),
  'ATXHeading5': Decoration.mark({ class: 'cm-wysiwyg-h5' }),
  'ATXHeading6': Decoration.mark({ class: 'cm-wysiwyg-h6' }),

  // Links
  'Link': Decoration.mark({ class: 'cm-wysiwyg-link' }),
  'URL': Decoration.mark({ class: 'cm-wysiwyg-url' }),

  // Blockquotes
  'Blockquote': Decoration.mark({ class: 'cm-wysiwyg-blockquote' }),
}

/**
 * Node types that need special content range handling.
 * For these nodes, we style only the content portion, not the markers.
 */
const CONTENT_STYLED_NODES = new Set([
  'Emphasis',
  'StrongEmphasis',
  'InlineCode',
  'Strikethrough',
  'Highlight',
  'ATXHeading1',
  'ATXHeading2',
  'ATXHeading3',
  'ATXHeading4',
  'ATXHeading5',
  'ATXHeading6',
  'Link',
])

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if cursor is within a given range (inclusive).
 */
function cursorInRange(selection, from, to) {
  return selection.from <= to && selection.to >= from
}

/**
 * Get the content range for a heading (after the HeaderMark and space).
 * Returns the range of actual heading text, excluding the # markers.
 */
function getHeadingContentRange(node, doc) {
  let contentStart = node.from
  const contentEnd = node.to

  // Find the HeaderMark child to skip it
  const cursor = node.cursor()
  if (cursor.firstChild()) {
    do {
      if (cursor.name === 'HeaderMark') {
        // Content starts after the HeaderMark plus the space
        const afterMark = doc.sliceString(cursor.to, Math.min(cursor.to + 1, doc.length))
        contentStart = cursor.to + (afterMark === ' ' ? 1 : 0)
        break
      }
    } while (cursor.nextSibling())
  }

  return { from: contentStart, to: contentEnd }
}

/**
 * Get the content range for inline formatting (between the marks).
 * Returns the range of content excluding opening and closing markers.
 */
function getInlineContentRange(node) {
  let openingMarkEnd = node.from
  let closingMarkStart = node.to

  const cursor = node.cursor()
  if (cursor.firstChild()) {
    let foundFirst = false
    do {
      if (SYNTAX_MARKERS.has(cursor.name)) {
        if (!foundFirst) {
          openingMarkEnd = cursor.to
          foundFirst = true
        } else {
          closingMarkStart = cursor.from
        }
      }
    } while (cursor.nextSibling())
  }

  return { from: openingMarkEnd, to: closingMarkStart }
}

/**
 * Get the text content range for a link (the visible text part [text]).
 * Returns the range of the link text, excluding brackets and URL.
 */
function getLinkTextRange(node) {
  let linkTextStart = -1
  let linkTextEnd = -1

  const cursor = node.cursor()
  if (cursor.firstChild()) {
    let bracketCount = 0
    do {
      if (cursor.name === 'LinkMark') {
        bracketCount++
        if (bracketCount === 1) {
          // After opening [
          linkTextStart = cursor.to
        } else if (bracketCount === 2) {
          // Before closing ]
          linkTextEnd = cursor.from
          break
        }
      }
    } while (cursor.nextSibling())
  }

  return { from: linkTextStart, to: linkTextEnd }
}

/**
 * StateEffect for toggling WYSIWYG mode on/off.
 * Usage: view.dispatch({ effects: toggleWysiwyg.of(true) })
 */
export const toggleWysiwyg = StateEffect.define()

/**
 * StateField that tracks whether WYSIWYG mode is currently enabled.
 * Default is true (WYSIWYG mode active).
 */
export const wysiwygEnabled = StateField.define({
  create() {
    return true
  },
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(toggleWysiwyg)) {
        return effect.value
      }
    }
    return value
  }
})

/**
 * Command function to toggle WYSIWYG mode.
 * Returns a function that can be called to toggle the mode.
 *
 * @param {EditorView} view - The CodeMirror editor view
 * @returns {boolean} - Always returns true to indicate command was handled
 */
export function setWysiwygMode(view) {
  const currentValue = view.state.field(wysiwygEnabled)
  view.dispatch({
    effects: toggleWysiwyg.of(!currentValue)
  })
  return true
}

// ============================================================================
// ViewPlugin
// ============================================================================

/**
 * ViewPlugin that handles WYSIWYG rendering by:
 * 1. Hiding syntax markers when the cursor is not within the parent formatting node
 * 2. Adding styling decorations (CSS classes) to formatted content
 *
 * Uses syntaxTree iteration for performance (viewport only) and
 * targets Lezer markdown node types for precise control.
 *
 * Special handling:
 * - Nested formatting (e.g., ***bold italic***) receives both bold and italic classes
 * - Headings are styled from after the HeaderMark to end of line
 * - Links have the text portion styled with the link class
 */
const wysiwygPlugin = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = this.computeDecorations(view)
    }

    update(update) {
      // Recompute when document changes, viewport changes, selection moves,
      // or WYSIWYG mode is toggled
      if (
        update.docChanged ||
        update.viewportChanged ||
        update.selectionSet ||
        update.transactions.some(tr => tr.effects.some(e => e.is(toggleWysiwyg)))
      ) {
        this.decorations = this.computeDecorations(update.view)
      }
    }

    computeDecorations(view) {
      // Check if WYSIWYG mode is enabled
      const enabled = view.state.field(wysiwygEnabled, false)
      if (!enabled) {
        return Decoration.none
      }

      const { doc } = view.state
      const selection = view.state.selection.main
      const tree = syntaxTree(view.state)

      // Collect all decorations first, then sort and add to builder
      const decorations = []

      // Process only visible ranges for performance
      for (const { from, to } of view.visibleRanges) {
        tree.iterate({
          from,
          to,
          enter: (node) => {
            const nodeName = node.name

            // 1. Handle syntax markers (hide when cursor not in parent)
            if (SYNTAX_MARKERS.has(nodeName)) {
              const parent = node.node.parent
              const shouldHide = parent && !cursorInRange(selection, parent.from, parent.to)

              if (shouldHide) {
                decorations.push({
                  from: node.from,
                  to: node.to,
                  decoration: Decoration.replace({})
                })
              }
              return
            }

            // 2. Handle styled content nodes
            if (STYLE_DECORATIONS[nodeName]) {
              // Check if cursor is in this node (show raw if editing)
              const isEditing = cursorInRange(selection, node.from, node.to)

              // For headings, style from after the HeaderMark to end of line
              if (nodeName.startsWith('ATXHeading')) {
                if (!isEditing) {
                  const { from: contentFrom, to: contentTo } = getHeadingContentRange(node.node, doc)
                  if (contentFrom < contentTo) {
                    decorations.push({
                      from: contentFrom,
                      to: contentTo,
                      decoration: STYLE_DECORATIONS[nodeName]
                    })
                  }
                }
                return
              }

              // For inline formatting (Emphasis, StrongEmphasis, InlineCode, Strikethrough, Highlight)
              // Style the content portion, excluding the markers
              if (CONTENT_STYLED_NODES.has(nodeName) && !nodeName.startsWith('ATXHeading')) {
                // For links, style only the link text portion
                if (nodeName === 'Link') {
                  const { from: textFrom, to: textTo } = getLinkTextRange(node.node)
                  if (textFrom >= 0 && textTo > textFrom) {
                    decorations.push({
                      from: textFrom,
                      to: textTo,
                      decoration: STYLE_DECORATIONS[nodeName]
                    })
                  }
                  return
                }

                // For other inline formatting, get content range (between markers)
                const { from: contentFrom, to: contentTo } = getInlineContentRange(node.node)
                if (contentFrom < contentTo) {
                  decorations.push({
                    from: contentFrom,
                    to: contentTo,
                    decoration: STYLE_DECORATIONS[nodeName]
                  })
                }
                return
              }

              // For other nodes (URL, Blockquote), apply to full range
              decorations.push({
                from: node.from,
                to: node.to,
                decoration: STYLE_DECORATIONS[nodeName]
              })
            }
          }
        })
      }

      // Sort decorations by position (required by RangeSetBuilder)
      decorations.sort((a, b) => {
        if (a.from !== b.from) return a.from - b.from
        if (a.to !== b.to) return a.to - b.to
        return 0
      })

      // Build the RangeSet
      const builder = new RangeSetBuilder()
      for (const { from, to, decoration } of decorations) {
        if (from >= 0 && to > from && to <= doc.length) {
          builder.add(from, to, decoration)
        }
      }

      return builder.finish()
    }
  },
  {
    decorations: v => v.decorations
  }
)

// ============================================================================
// Styles
// ============================================================================

/**
 * Styles for WYSIWYG mode. These ensure formatted content
 * appears correctly when syntax markers are hidden.
 */
const wysiwygStyles = EditorView.theme({
  // Ensure proper cursor behavior in hidden syntax regions
  '.cm-line': {
    caretColor: 'var(--editor-caret-color, currentColor)'
  },

  // ---- Inline Formatting ----

  '.cm-wysiwyg-bold': {
    fontWeight: '700 !important',
  },

  '.cm-wysiwyg-italic': {
    fontStyle: 'italic !important',
  },

  // Bold + Italic combined (nested formatting)
  '.cm-wysiwyg-bold.cm-wysiwyg-italic': {
    fontWeight: '700 !important',
    fontStyle: 'italic !important',
  },

  '.cm-wysiwyg-code': {
    fontFamily: 'var(--font-mono, SFMono-Regular, Consolas, "Liberation Mono", Menlo, monospace) !important',
    backgroundColor: 'var(--code-bg, rgba(0, 0, 0, 0.05)) !important',
    padding: '0.1em 0.3em !important',
    borderRadius: '3px !important',
    fontSize: '0.9em !important',
  },

  '.cm-wysiwyg-strikethrough': {
    textDecoration: 'line-through !important',
    color: 'var(--text-muted, #6b7280) !important',
  },

  '.cm-wysiwyg-highlight': {
    backgroundColor: 'var(--highlight-bg, #fff3a3) !important',
    padding: '0.1em 0 !important',
    borderRadius: '2px !important',
  },

  // ---- Headings ----

  '.cm-wysiwyg-h1': {
    fontSize: '1.8em !important',
    fontWeight: '700 !important',
    lineHeight: '1.2 !important',
    color: 'var(--heading-color, inherit) !important',
  },

  '.cm-wysiwyg-h2': {
    fontSize: '1.5em !important',
    fontWeight: '700 !important',
    lineHeight: '1.25 !important',
    color: 'var(--heading-color, inherit) !important',
  },

  '.cm-wysiwyg-h3': {
    fontSize: '1.25em !important',
    fontWeight: '700 !important',
    lineHeight: '1.3 !important',
    color: 'var(--heading-color, inherit) !important',
  },

  '.cm-wysiwyg-h4': {
    fontSize: '1.1em !important',
    fontWeight: '700 !important',
    lineHeight: '1.35 !important',
    color: 'var(--heading-color, inherit) !important',
  },

  '.cm-wysiwyg-h5': {
    fontSize: '1em !important',
    fontWeight: '700 !important',
    lineHeight: '1.4 !important',
    color: 'var(--heading-color, inherit) !important',
  },

  '.cm-wysiwyg-h6': {
    fontSize: '0.9em !important',
    fontWeight: '700 !important',
    lineHeight: '1.4 !important',
    color: 'var(--text-muted, #6b7280) !important',
  },

  // ---- Links ----

  '.cm-wysiwyg-link': {
    color: 'var(--link-color, #2563eb) !important',
    textDecoration: 'underline !important',
    textDecorationColor: 'var(--link-underline, rgba(37, 99, 235, 0.4)) !important',
    cursor: 'pointer !important',
    '&:hover': {
      textDecorationColor: 'var(--link-color, #2563eb) !important',
    },
  },

  '.cm-wysiwyg-url': {
    color: 'var(--text-muted, #6b7280) !important',
    fontSize: '0.9em !important',
  },

  // ---- Blockquotes ----

  '.cm-wysiwyg-blockquote': {
    borderLeft: '3px solid var(--border-color, #e5e7eb) !important',
    paddingLeft: '1em !important',
    color: 'var(--text-muted, #6b7280) !important',
    fontStyle: 'italic !important',
  },
})

// ============================================================================
// Atomic Ranges (for cursor behavior)
// ============================================================================

/**
 * Makes hidden syntax markers behave as atomic units for cursor movement.
 * When arrow keys are pressed, the cursor skips over hidden content.
 */
const wysiwygAtomicRanges = EditorView.atomicRanges.of(view => {
  const { state } = view
  const enabled = state.field(wysiwygEnabled, false)

  if (!enabled) {
    return Decoration.none
  }

  const selection = state.selection.main
  const tree = syntaxTree(state)
  const ranges = []

  // Find all hidden syntax markers
  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter: (node) => {
        if (SYNTAX_MARKERS.has(node.name)) {
          const parent = node.node.parent
          if (parent && !cursorInRange(selection, parent.from, parent.to)) {
            ranges.push({ from: node.from, to: node.to })
          }
        }
      }
    })
  }

  // Sort and build RangeSet
  ranges.sort((a, b) => a.from - b.from)
  const builder = new RangeSetBuilder()
  for (const { from, to } of ranges) {
    if (from >= 0 && to > from && to <= state.doc.length) {
      builder.add(from, to, Decoration.mark({ atomic: true }))
    }
  }

  return builder.finish()
})

// ============================================================================
// Extension Bundle
// ============================================================================

/**
 * Creates the WYSIWYG extension array for use with CodeMirror.
 *
 * @param {boolean} enabled - Initial enabled state (default: true)
 * @returns {Extension[]} - Array of extensions to add to the editor
 *
 * @example
 * import { wysiwygExtension } from './wysiwyg-extension.js'
 *
 * const editor = new EditorView({
 *   extensions: [
 *     ...wysiwygExtension(true),
 *     // other extensions
 *   ]
 * })
 */
export function wysiwygExtension(enabled = true) {
  return [
    wysiwygEnabled.init(() => enabled),
    wysiwygPlugin,
    wysiwygAtomicRanges,
    wysiwygStyles
  ]
}

// ============================================================================
// Additional Exports
// ============================================================================

// Export individual components for advanced usage
export {
  STYLE_DECORATIONS,
  SYNTAX_MARKERS,
  wysiwygPlugin,
  wysiwygStyles,
  wysiwygAtomicRanges,
}

// Default export
export default wysiwygExtension
