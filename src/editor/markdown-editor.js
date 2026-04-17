import { EditorView, keymap, drawSelection, highlightActiveLine, 
         lineNumbers, highlightActiveLineGutter, rectangularSelection,
         crosshairCursor, dropCursor, ViewPlugin, Decoration, WidgetType } from '@codemirror/view'
import { EditorState, Compartment, RangeSet, Facet, StateField, StateEffect } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { autocompletion, completionKeymap, closeBrackets, 
         closeBracketsKeymap, startCompletion } from '@codemirror/autocomplete'
import { lintKeymap } from '@codemirror/lint'
import { syntaxHighlighting, defaultHighlightStyle, HighlightStyle,
         bracketMatching, foldGutter, indentOnInput, foldEffect } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { oneDark } from '@codemirror/theme-one-dark'
import { invoke } from '@tauri-apps/api/core'
import { 
  search, searchKeymap, highlightSelectionMatches, 
  openSearchPanel, closeSearchPanel,
  replaceNext, replaceAll, SearchQuery, getSearchQuery, setSearchQuery
} from '@codemirror/search'
import { livePreviewPlugin, livePreviewStyles } from './live-preview.js'
import { inlineFormattingExtension, inlineFormattingStyles, blockWidgetExtension } from './formatting-extension.js'
import { imageEmbedPlugin } from './image-extension.js'
import { linkPlugin, linkStyles } from './link-extension.js'
import { wikiLinkPlugin, wikiLinkStyles } from './wikilink-extension.js'
import { wikiLinkCompletionSource, createWikiLinkCompletion } from './wikilink-autocompletion.js'
import { tidCompletionSource } from './tid-autocomplete.js'
import { imagePasteExtension } from './image-paste-extension.js'
import { summarizeHighlightsCommand } from './highlights-extension.js'
import { bulletListExtension } from './bullet-list-extension.js'
import { taskExtensionConfig } from './task-extension.js'
// wysiwygExtension is no longer used - WYSIWYG functionality is now provided by
// inlineFormattingExtension, inlineFormattingStyles, and blockWidgetExtension
// which are controlled via wysiwygCompartment
import { slashCommandExtension } from './slash-command-menu.js'
import { floatingToolbarExtension } from './floating-toolbar.js'

// Compartments for dynamic configuration
const themeCompartment = new Compartment()
const lineWrappingCompartment = new Compartment()
const fontSizeCompartment = new Compartment()
const lineNumbersCompartment = new Compartment()
const frontmatterCompartment = new Compartment()
const wysiwygCompartment = new Compartment()

// State field to store the current file path
const currentFilePathField = StateField.define({
  create() { return null },
  update(value, tr) {
    for (let effect of tr.effects) {
      if (effect.is(setCurrentFilePath)) {
        return effect.value
      }
    }
    return value
  }
})

const setCurrentFilePath = StateEffect.define()

// Make the field globally accessible for the bullet-list extension
window.currentFilePath = currentFilePathField

// Custom highlight style for links/URLs that uses CSS variables for theming
// This allows link colors to change with light/dark theme
const linkHighlightStyle = HighlightStyle.define([
  { tag: tags.link, class: 'cm-link-highlight' },
  { tag: tags.url, class: 'cm-url-highlight' }
])

export class MarkdownEditor {
  constructor(container, initialContent = '') {
    this.container = container
    this.themeCompartment = themeCompartment
    this.lineWrappingCompartment = lineWrappingCompartment
    this.fontSizeCompartment = fontSizeCompartment
    this.lineNumbersCompartment = lineNumbersCompartment
    this.frontmatterCompartment = frontmatterCompartment
    this.wysiwygCompartment = wysiwygCompartment
    this.wysiwygEnabled = true // Default: WYSIWYG enabled
    this.editorId = `editor-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    
    // Initialize with light theme by default
    this.currentTheme = 'default' // This is our light theme
    this.customThemes = new Map()
    this.hasUnsavedChanges = false
    this.currentFile = null
    this.showLineNumbers = false // Default to hiding line numbers
    this.lineWrapping = true // Default to enabling line wrapping
    
    // Stored frontmatter for body-only editing
    this.frontmatterRaw = ''
    this.frontmatterFields = new Map()
    // Make reload method available globally for bullet-list extension
    window.reloadCurrentFile = async () => {
      if (this.currentFile) {
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          const content = await invoke('read_file_content', { filePath: this.currentFile });
          // Preserve cursor position
          const cursor = this.view.state.selection.main.head;
          this.setContent(content, false, this.currentFile, true);
          // Restore cursor position
          this.view.dispatch({
            selection: { anchor: cursor, head: cursor },
            scrollIntoView: true
          });
        } catch (error) {
          console.error('[MarkdownEditor] Failed to reload file:', error);
        }
      }
    }
    
    this.setupEditor(initialContent)
    this.setupTauriListeners()
    
    // Track editor creation performance
    if (window.perfMonitor) {
      window.perfMonitor.trackEditorMetrics(this.editorId, 'creation', Date.now() - performance.now());
    }
    
    console.log(`📝 MarkdownEditor created with ID: ${this.editorId}`);
    
    // Apply any pending editor settings from vault
    if (window.pendingEditorSettings) {
      if (window.pendingEditorSettings.lineNumbers !== undefined) {
        this.setLineNumbers(window.pendingEditorSettings.lineNumbers)
      }
      if (window.pendingEditorSettings.lineWrapping !== undefined) {
        this.setLineWrapping(window.pendingEditorSettings.lineWrapping)
      }
      if (window.pendingEditorSettings.fontSize !== undefined) {
        // Apply font size after a short delay to ensure view is ready
        setTimeout(() => {
          this.view.dispatch({
            effects: this.fontSizeCompartment.reconfigure(
              this.createFontSizeTheme(window.pendingEditorSettings.fontSize)
            )
          })
        }, 100)
      }
      if (window.pendingEditorSettings.wysiwygMode !== undefined) {
        // Apply WYSIWYG mode after a short delay to ensure view is ready
        setTimeout(() => {
          this.setWysiwygMode(window.pendingEditorSettings.wysiwygMode)
        }, 100)
      }
    }
  }

  // Parse YAML frontmatter at the top of content
  parseFrontmatter(content) {
    try {
      const m = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/)
      if (!m) return { raw: '', fields: new Map(), body: content }
      const raw = m[0]
      const inner = raw.replace(/^---\r?\n/, '').replace(/\r?\n---\r?\n$/, '')
      const fields = new Map()
      inner.split(/\r?\n/).forEach(line => {
        const idx = line.indexOf(':')
        if (idx > -1) {
          const key = line.slice(0, idx).trim()
          let value = line.slice(idx + 1).trim()
          if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1)
          }
          if (key) fields.set(key, value)
        }
      })
      const body = content.slice(raw.length)
      return { raw, fields, body }
    } catch (_) {
      return { raw: '', fields: new Map(), body: content }
    }
  }

  // Widget-only plugin that reads stored frontmatter
  createFrontmatterWidget() {
    const editor = this
    return ViewPlugin.fromClass(class {
      constructor() {
        this.decorations = this.build()
      }
      build() {
        if (!editor.frontmatterRaw || editor.frontmatterRaw.length === 0) return Decoration.none
        class PropsWidget extends WidgetType {
          constructor(fields, collapsed = true) { super(); this.fields = fields; this.collapsed = collapsed }
          toDOM() {
            const container = document.createElement('div')
            container.className = 'frontmatter-properties-container'
            const header = document.createElement('div')
            header.className = 'frontmatter-properties-header'
            const arrow = document.createElement('span')
            arrow.textContent = this.collapsed ? '▶' : '▼'
            arrow.style.marginRight = '6px'
            arrow.style.fontSize = '10px'
            const label = document.createElement('span')
            label.textContent = 'Properties'
            header.appendChild(arrow); header.appendChild(label)
            const content = document.createElement('div')
            content.className = 'frontmatter-properties-content'
            content.style.display = this.collapsed ? 'none' : 'block'
            const ordered = ['id', 'created_at', 'updated_at']
            const fields = this.fields || new Map()
            const other = Array.from(fields.keys()).filter(k => !ordered.includes(k)).sort()
            const keys = [...ordered.filter(k => fields.has(k)), ...other]
            keys.forEach(k => {
              const row = document.createElement('div')
              const kspan = document.createElement('span'); kspan.textContent = k
              const vspan = document.createElement('span'); vspan.textContent = fields.get(k)
              row.appendChild(kspan); row.appendChild(vspan)
              content.appendChild(row)
            })
            // Toggle collapse on header click/keypress
            const toggle = (e) => {
              e.preventDefault(); e.stopPropagation();
              this.collapsed = !this.collapsed
              arrow.textContent = this.collapsed ? '▶' : '▼'
              content.style.display = this.collapsed ? 'none' : 'block'
            }
            header.addEventListener('click', toggle)
            header.tabIndex = 0
            header.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') toggle(e) })
            container.appendChild(header)
            container.appendChild(content)
            return container
          }
          eq(other) { return other.collapsed === this.collapsed }
          ignoreEvent() { return false }
        }
        return Decoration.set([Decoration.widget({ widget: new PropsWidget(editor.frontmatterFields, true), side: -1 }).range(0)])
          }
      update(u) { if (u.docChanged) this.decorations = this.build() }
    }, { decorations: v => v.decorations })
  }

  createFrontmatterPlugin() {
    // Create an Obsidian-style collapsible frontmatter plugin
    return ViewPlugin.fromClass(class {
      constructor(view) {
        this.collapsed = true // Default to collapsed like Obsidian
        this.decorations = this.buildDecorations(view)
      }
      
      buildDecorations(view) {
        const doc = view.state.doc
        const text = doc.toString()
        
        // Check if document starts with frontmatter
        if (!text.startsWith('---\n') && !text.startsWith('---\r\n')) {
          return Decoration.none
        }
        
        // Find the end of frontmatter
        const lines = text.split('\n')
        let endLine = -1
        let frontmatterLines = []
        
        for (let i = 1; i < lines.length; i++) {
          if (lines[i].trim() === '---') {
            endLine = i
            break
          }
          // Include all lines (even empty ones) until closing ---
          frontmatterLines.push(lines[i])
        }
        
        if (endLine === -1) {
          return Decoration.none
        }
        
        // Create the Properties header widget
        const self = this
        class PropertiesHeader {
          constructor() {
            this.collapsed = self.collapsed
          }
          
          toDOM() {
            const container = document.createElement('div')
            container.className = 'frontmatter-properties-container'
            container.style.cssText = `
              margin: 0 0 4px 0;
              background: #f8f9fa;
              border: 1px solid #e1e4e8;
              border-radius: 6px;
              padding: 8px;
            `
            
            // Properties header
            const header = document.createElement('div')
            header.className = 'frontmatter-properties-header'
            header.style.cssText = `
              display: flex;
              align-items: center;
              padding: 4px 0;
              cursor: pointer;
              user-select: none;
              font-weight: 400;
              font-size: 13px;
              color: #6b6b6b;
              background: transparent;
              border: none;
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            `
            
            // Arrow icon
            const arrow = document.createElement('span')
            arrow.style.cssText = `
              margin-right: 6px;
              font-size: 10px;
              color: #6b6b6b;
              transition: transform 0.15s ease;
              transform: ${this.collapsed ? 'rotate(0deg)' : 'rotate(90deg)'};
              width: 12px;
              height: 12px;
              display: flex;
              align-items: center;
              justify-content: center;
            `
            arrow.textContent = '▶'
            
            // Properties text
            const label = document.createElement('span')
            label.textContent = 'Properties'
            
            // Add keyboard accessibility
            header.setAttribute('tabindex', '0')
            header.setAttribute('role', 'button')
            header.setAttribute('aria-expanded', this.collapsed ? 'false' : 'true')
            header.setAttribute('aria-label', `${this.collapsed ? 'Expand' : 'Collapse'} properties section`)
            
            // Keyboard navigation
            header.addEventListener('keydown', (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                header.click()
              }
            })
            
            header.appendChild(arrow)
            header.appendChild(label)
            container.appendChild(header)
            
            // If expanded, show the frontmatter content
            if (!this.collapsed) {
              const content = document.createElement('div')
              content.className = 'frontmatter-properties-content'
              content.style.cssText = `
                padding: 8px 0 8px 18px;
                background: transparent;
                border: none;
                font-size: 13px;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
              `
              
              // Parse frontmatter properties into a map
              const properties = new Map()
              frontmatterLines.forEach(line => {
                if (line.trim()) {
                  const colonIndex = line.indexOf(':')
                  if (colonIndex > -1) {
                    const key = line.substring(0, colonIndex).trim()
                    let value = line.substring(colonIndex + 1).trim()
                    
                    // Remove quotes from value if present
                    if ((value.startsWith('"') && value.endsWith('"')) || 
                        (value.startsWith("'") && value.endsWith("'"))) {
                      value = value.slice(1, -1)
                    }
                    
                    properties.set(key, value)
                  }
                }
              })
              
              // Define the desired order: id first, then created_at, then updated_at, then others
              const orderedKeys = ['id', 'created_at', 'updated_at']
              const otherKeys = Array.from(properties.keys())
                .filter(key => !orderedKeys.includes(key))
                .sort()
              
              // Display properties in the desired order
              const allKeys = [...orderedKeys.filter(key => properties.has(key)), ...otherKeys]
              
              allKeys.forEach(key => {
                const value = properties.get(key)
                const propDiv = document.createElement('div')
                propDiv.style.cssText = `
                  padding: 1px 0;
                  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                  font-size: 13px;
                  color: #37352f;
                  display: flex;
                  align-items: center;
                  min-height: 20px;
                `
                
                const keySpan = document.createElement('span')
                keySpan.style.cssText = 'font-weight: 400; color: #6b6b6b; min-width: 80px; margin-right: 8px;'
                keySpan.textContent = key
                
                const valueSpan = document.createElement('span')
                valueSpan.style.cssText = 'color: #37352f; flex: 1;'
                valueSpan.textContent = value
                
                propDiv.appendChild(keySpan)
                propDiv.appendChild(valueSpan)
                content.appendChild(propDiv)
              })
              
              container.appendChild(content)
            }
            
            // Hover effects
            header.addEventListener('mouseenter', () => {
              header.style.color = '#37352f'
              arrow.style.color = '#37352f'
            })
            
            header.addEventListener('mouseleave', () => {
              header.style.color = '#6b6b6b'
              arrow.style.color = '#6b6b6b'
            })
            
            // Click handler to toggle collapse
            header.addEventListener('click', (e) => {
              e.preventDefault()
              e.stopPropagation()
              self.collapsed = !self.collapsed
              
              // Update arrow rotation immediately for smooth animation
              arrow.style.transform = self.collapsed ? 'rotate(0deg)' : 'rotate(90deg)'
              
              // Update accessibility attributes
              header.setAttribute('aria-expanded', self.collapsed ? 'false' : 'true')
              header.setAttribute('aria-label', `${self.collapsed ? 'Expand' : 'Collapse'} properties section`)
              
              self.decorations = self.buildDecorations(view)
              view.dispatch({
                effects: []
              })
              view.requestMeasure()
            })
            
            return container
          }
          
          ignoreEvent() { return false }
          
          destroy(dom) {
            // Clean up any event listeners if needed
            // CodeMirror calls this when the widget is removed
          }
          
          coordsAt(dom, pos, side) {
            // Required method for CodeMirror widget positioning
            return null
          }
          
          compare(other) {
            // Compare widget state to determine if re-rendering is needed
            return other instanceof PropertiesHeader && 
                   this.collapsed === other.collapsed
          }
        }
        
        // Only insert the Properties widget; editor doc may be body-only
        return Decoration.set([
          Decoration.widget({ widget: new PropertiesHeader(), side: -1 }).range(0)
        ])
      }
      
      update(update) {
        if (update.docChanged) this.decorations = this.buildDecorations(update.view)
      }
    }, {
      decorations: v => v.decorations
    })
  }

  setupEditor(content) {
    // Body-only editing: parse frontmatter and keep it stored
    const parsed = this.parseFrontmatter(content || '')
    this.frontmatterRaw = parsed.raw
    this.frontmatterFields = parsed.fields
    const bodyOnly = parsed.body
    // Create a shared state object for highlight tracking
    const highlightState = { 
      waitingForSecondEqual: false,
      selectedText: '',
      from: 0,
      to: 0
    }
    
    // Create a shared state object for underline tracking (_text_)
    const italicState = {
      waitingForSecondUnderscore: false,
      selectedText: '',
      from: 0,
      to: 0
    }
    
    // Create a shared state object for italic tracking (ii)
    const italicIIState = {
      waitingForSecondI: false,
      selectedText: '',
      from: 0,
      to: 0
    }
    
    // Create a shared state object for bold tracking (**)
    const boldState = {
      waitingForSecondStar: false,
      selectedText: '',
      from: 0,
      to: 0
    }
    
    const extensions = [
      // State field for current file path
      currentFilePathField,
      
      // Manual basicSetup configuration with all essential functionality including double-click word selection
      this.lineNumbersCompartment.of(this.showLineNumbers ? [lineNumbers(), highlightActiveLineGutter(), foldGutter()] : []),
      history(),
      drawSelection(),
      dropCursor(),
      EditorState.allowMultipleSelections.of(true),
      indentOnInput(),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      syntaxHighlighting(linkHighlightStyle),  // Custom link colors using CSS variables
      bracketMatching(),
      // Configure closeBrackets to exclude square brackets for WikiLinks
      closeBrackets({
        // Only include opening brackets we want to auto-close (exclude [ ])
        brackets: ["(", "{", '"', "'", "`"],
        before: ")]}\"'`"
      }),
      
      // Combined autocompletion for WikiLinks and TIDs
      autocompletion({
        override: [
          // Combine both completion sources
          async (context) => {
            // Check for TID pattern IMMEDIATELY before cursor (more specific check)
            const beforeCursor = context.state.doc.sliceString(Math.max(0, context.pos - 20), context.pos)
            const hasTidPattern = /\[\[(TID|tid):\s*[^\]]*$/i.test(beforeCursor)
            
            if (hasTidPattern) {
              console.log('TID pattern detected, calling TID completion')
              // TID pattern detected, use TID completion
              const tidResult = await tidCompletionSource(context)
              console.log('TID result:', tidResult)
              return tidResult
            } else {
              // Try WikiLink completion for other patterns
              const wikiResult = await wikiLinkCompletionSource(context)
              return wikiResult
            }
          }
        ],
        activateOnTyping: true,
        maxRenderedOptions: 50,
        closeOnBlur: false,
        icons: false
      }),
      rectangularSelection(),
      crosshairCursor(),
      highlightActiveLine(),
      
      // Bullet list continuation on Enter (must come before default keymaps)
      bulletListExtension(),
      
      // Keep Cmd+F on the editor for plain text find/replace
      keymap.of([
        {
          key: "Mod-f",
          run: (view) => {
            openSearchPanel(view)
            return true
          }
        },
        // Replace All convenience shortcut
        {
          key: "Mod-Alt-Enter",
          run: (view) => replaceAll(view)
        },
        // Replace Next convenience shortcut
        {
          key: "Mod-Alt-j",
          run: (view) => replaceNext(view)
        }
      ]),
      
      // Default keymaps
      keymap.of([
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...searchKeymap,
        ...historyKeymap,
        ...completionKeymap,
        ...lintKeymap
      ]),
      
      // Markdown specific
      markdown({
        base: markdownLanguage,
        codeLanguages: languages,
        addKeymap: false // Disable markdown keymap to prevent selection expansion
      }),
      
      // Enhanced live preview - both plugin and styles
      livePreviewPlugin,
      livePreviewStyles,
      
      // Search functionality
      search({
        top: true, // Show search panel at the top
        caseSensitive: false,
        literal: false,
        wholeWord: false
      }),
      highlightSelectionMatches(),
      
      // WYSIWYG extensions are now in the wysiwygCompartment (see below)
      // to allow toggling WYSIWYG mode on/off via settings
      
      // Image embedding with ![](URL) syntax
      imageEmbedPlugin,
      
      // Markdown links with [text](url) syntax
      linkPlugin,
      linkStyles,
      
      // WikiLinks with [[Page Name]] syntax
      wikiLinkPlugin,
      wikiLinkStyles,
      
      // Task management with checkboxes and properties
      ...taskExtensionConfig(),
      
      // Add a view plugin to detect WikiLink completions
      ViewPlugin.fromClass(class {
        constructor(view) {
          this.view = view
        }
        
        update(update) {
          // Check if this is a completion transaction
          if (update.transactions.some(tr => tr.isUserEvent("input.complete"))) {
            console.log("WikiLink completion applied, forcing decoration update")
            // Schedule an update to refresh WikiLink decorations
            setTimeout(() => {
              if (!this.view.isDestroyed) {
                this.view.dispatch({
                  effects: []
                })
              }
            }, 50)
          }
        }
      }),
      
      // Image paste handler
      imagePasteExtension(),

      // Slash command menu (triggered by typing /)
      slashCommandExtension(),

      // Floating toolbar for text selection formatting
      floatingToolbarExtension(),

      // Additional custom keybindings
      keymap.of([
        indentWithTab,
        ...this.customKeymap()
      ]),
      
      // Enhanced double-click word selection and triple-click paragraph selection
      EditorView.domEventHandlers({
        dblclick: (event, view) => {
          console.log('🖱️ Double-click detected at:', event.clientX, event.clientY)
          
          // Get the position where the click occurred
          const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
          if (pos === null) {
            console.log('❌ Could not get position from click coordinates')
            return false
          }
          
          console.log('📍 Click position:', pos)
          
          // Use CodeMirror's built-in word selection logic
          const doc = view.state.doc
          const line = doc.lineAt(pos)
          const lineText = line.text
          const linePos = pos - line.from
          
          console.log('📝 Line text:', lineText)
          console.log('📍 Position in line:', linePos)
          
          // Find word boundaries using better logic
          let start = linePos
          let end = linePos
          
          // More comprehensive word boundary detection
          const isWordChar = (char) => /[a-zA-Z0-9_\u00C0-\u017F\u0100-\u024F]/.test(char)
          
          // Expand left to find word start
          while (start > 0 && isWordChar(lineText[start - 1])) {
            start--
          }
          
          // Expand right to find word end
          while (end < lineText.length && isWordChar(lineText[end])) {
            end++
          }
          
          // If we found a word, select it
          if (start < end) {
            const from = line.from + start
            const to = line.from + end
            const selectedText = lineText.slice(start, end)
            
            console.log('✅ Selecting word:', selectedText, 'from', from, 'to', to)
            
            // Create the selection and update the view
            view.dispatch({
              selection: { anchor: from, head: to },
              scrollIntoView: true
            })
            
            // Verify the selection was set
            setTimeout(() => {
              const currentSelection = view.state.selection.main
              if (!currentSelection.empty) {
                const actualSelected = view.state.doc.sliceString(currentSelection.from, currentSelection.to)
                console.log('✅ Final selection:', actualSelected)
              } else {
                console.log('❌ Selection appears to be empty')
              }
            }, 10)
            
            return true // We handled the event
          }
          
          console.log('❌ No word found at click position')
          return false
        },
        
        // Triple-click paragraph selection 
        click: (event, view) => {
          // Check if this is a triple-click
          if (event.detail === 3) {
            console.log('🖱️ Triple-click detected - selecting paragraph')
            
            const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
            if (pos === null) {
              console.log('❌ Could not get position from click coordinates')
              return false
            }
            
            const doc = view.state.doc
            const clickLine = doc.lineAt(pos)
            
            // Find paragraph boundaries
            let startLine = clickLine.number
            let endLine = clickLine.number
            
            // Helper function to check if a line is a paragraph boundary
            const isParagraphBoundary = (line) => {
              const text = line.text.trim()
              if (text === '') return true // Empty line
              if (text.startsWith('#')) return true // Header
              if (text.startsWith('- ') || text.startsWith('* ') || text.startsWith('+ ')) return true // List items
              if (text.startsWith('> ')) return true // Blockquote
              if (text.match(/^\d+\. /)) return true // Numbered list
              if (text.startsWith('```')) return true // Code block
              if (text.startsWith('---') || text.startsWith('***')) return true // Horizontal rule
              return false
            }
            
            // Look backwards to find paragraph start
            while (startLine > 1) {
              const prevLine = doc.line(startLine - 1)
              if (isParagraphBoundary(prevLine)) {
                // Found paragraph boundary - stop here
                break
              }
              startLine--
            }
            
            // Look forwards to find paragraph end
            while (endLine < doc.lines) {
              const nextLine = doc.line(endLine + 1)
              if (isParagraphBoundary(nextLine)) {
                // Found paragraph boundary - stop here
                break
              }
              endLine++
            }
            
            // Select from start of first line to end of last line (excluding newline)
            const from = doc.line(startLine).from
            const to = doc.line(endLine).to
            
            console.log(`✅ Selecting paragraph from line ${startLine} to ${endLine}`, 'from', from, 'to', to)
            
            view.dispatch({
              selection: { anchor: from, head: to },
              scrollIntoView: true
            })
            
            // Verify the selection
            setTimeout(() => {
              const currentSelection = view.state.selection.main
              if (!currentSelection.empty) {
                const actualSelected = view.state.doc.sliceString(currentSelection.from, currentSelection.to)
                console.log('✅ Final paragraph selection:', actualSelected)
              }
            }, 10)
            
            return true // We handled the event
          }
          
          return false // Not a triple-click, let CodeMirror handle it
        }
      }),
      
      // Dynamic compartments - default to light theme
      this.themeCompartment.of(this.createTheme('default')),
      this.lineWrappingCompartment.of(EditorView.lineWrapping),
      this.fontSizeCompartment.of(this.createFontSizeTheme(window.pendingEditorSettings?.fontSize || 16)),
      this.frontmatterCompartment.of(this.createFrontmatterWidget()),
      // WYSIWYG mode extensions - these hide markdown syntax when the line is not active
      // Put in a compartment so it can be toggled on/off via settings
      this.wysiwygCompartment.of(this.wysiwygEnabled ? [
        inlineFormattingExtension,
        inlineFormattingStyles,
        blockWidgetExtension
      ] : []),
      
      // Input handler for == and ** wrapping
      EditorView.inputHandler.of((view, from, to, text) => {
        // Removed automatic trigger on [[ since we want to wait for user to start typing
        
        // Check if typing '=' with selected text for highlighting
        if (text === '=' && from !== to) {
          const selectedText = view.state.doc.sliceString(from, to)
          
          // Check if we should start highlight wrapping
          if (!highlightState.waitingForSecondEqual) {
            highlightState.waitingForSecondEqual = true
            highlightState.selectedText = selectedText
            highlightState.from = from
            highlightState.to = to
            
            // Insert just the first '=' for now
            view.dispatch({
              changes: { from, to, insert: '=' },
              selection: { anchor: from + 1 }
            })
            return true
          }
        }
        // Check if typing second '=' after first one
        else if (text === '=' && highlightState.waitingForSecondEqual) {
          const state = highlightState
          highlightState.waitingForSecondEqual = false
          
          // Insert the wrapped text
          view.dispatch({
            changes: { 
              from: state.from, 
              to: view.state.selection.main.from,
              insert: `==${state.selectedText}==` 
            },
            selection: { anchor: state.from + 2 + state.selectedText.length + 2 }
          })
          return true
        }
        // Check if typing 'i' with selected text for italic
        else if (text === 'i' && from !== to) {
          const selectedText = view.state.doc.sliceString(from, to)
          
          // Check if we should start italic tracking
          if (!italicIIState.waitingForSecondI) {
            italicIIState.waitingForSecondI = true
            italicIIState.selectedText = selectedText
            italicIIState.from = from
            italicIIState.to = to  // Store the original end position
            
            // Insert just the first 'i' for now, but don't change the text boundaries
            view.dispatch({
              changes: { from, to, insert: 'i' },
              selection: { anchor: from + 1 }
            })
            return true
          }
        }
        // Check if typing second 'i' after first one
        else if (text === 'i' && italicIIState.waitingForSecondI) {
          const state = italicIIState
          italicIIState.waitingForSecondI = false
          
          // We want to replace the "i" that's currently there, plus the "i" we're about to type
          // with "*originalText*"
          view.dispatch({
            changes: { 
              from: state.from, 
              to: state.from + 1, // Remove just the existing "i"
              insert: `*${state.selectedText}*` 
            },
            selection: { anchor: state.from + 1 + state.selectedText.length + 1 }
          })
          return true
        }
        // Check if typing '*' with selected text for bold
        else if (text === '*' && from !== to) {
          const selectedText = view.state.doc.sliceString(from, to)
          
          // Check if we should start bold tracking
          if (!boldState.waitingForSecondStar) {
            boldState.waitingForSecondStar = true
            boldState.selectedText = selectedText
            boldState.from = from
            boldState.to = to
            
            // Insert just the first '*' for now
            view.dispatch({
              changes: { from, to, insert: '*' },
              selection: { anchor: from + 1 }
            })
            return true
          }
        }
        // Check if typing second '*' after first one
        else if (text === '*' && boldState.waitingForSecondStar) {
          const state = boldState
          boldState.waitingForSecondStar = false
          
          // Insert the wrapped text with double asterisks for bold
          view.dispatch({
            changes: { 
              from: state.from, 
              to: view.state.selection.main.from,
              insert: `**${state.selectedText}**` 
            },
            selection: { anchor: state.from + 2 + state.selectedText.length + 2 }
          })
          return true
        }
        // Check if typing '_' with selected text for italic
        else if (text === '_' && from !== to) {
          const selectedText = view.state.doc.sliceString(from, to)
          
          // Check if we should start italic wrapping
          if (!italicState.waitingForSecondUnderscore) {
            italicState.waitingForSecondUnderscore = true
            italicState.selectedText = selectedText
            italicState.from = from
            italicState.to = to
            
            // Insert just the first '_' for now
            view.dispatch({
              changes: { from, to, insert: '_' },
              selection: { anchor: from + 1 }
            })
            return true
          }
        }
        // Check if typing second '_' after first one
        else if (text === '_' && italicState.waitingForSecondUnderscore) {
          const state = italicState
          italicState.waitingForSecondUnderscore = false
          
          // Insert the wrapped text
          view.dispatch({
            changes: { 
              from: state.from, 
              to: view.state.selection.main.from,
              insert: `_${state.selectedText}_` 
            },
            selection: { anchor: state.from + 1 + state.selectedText.length + 1 }
          })
          return true
        }
        // Clear states if typing something else
        else {
          if (highlightState.waitingForSecondEqual && text !== '=') {
            highlightState.waitingForSecondEqual = false
          }
          if (italicState.waitingForSecondUnderscore && text !== '_') {
            italicState.waitingForSecondUnderscore = false
          }
          if (italicIIState.waitingForSecondI && text !== 'i') {
            italicIIState.waitingForSecondI = false
          }
          if (boldState.waitingForSecondStar && text !== '*') {
            boldState.waitingForSecondStar = false
          }
        }
        
        return false
      }),
      
      // Update listener for Rust backend
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          this.handleContentChange(update)
        }
        
        // Debug selection changes
        if (update.selectionSet) {
          console.log('📝 Selection changed:', update.state.selection.main)
          const selection = update.state.selection.main
          if (!selection.empty) {
            const selectedText = update.state.doc.sliceString(selection.from, selection.to)
            console.log('✅ Selected text:', `"${selectedText}"`)
          }
        }
      })
    ]

    this.state = EditorState.create({
      doc: bodyOnly,
      extensions
    })

    this.view = new EditorView({
      state: this.state,
      parent: this.container
    })

    // Clear selection on initial load to avoid showing raw markdown
    this.clearInitialSelection()
  }

  customKeymap() {
    return [
      { key: "Mod-s", run: () => { this.save(); return true }},
      // Formatting shortcuts are handled at document level in main.js
      // to ensure they work even when editor doesn't have focus
      { key: "Mod-Shift-k", run: () => { this.togglePreview(); return true }},
      { key: "Mod-Shift-h", run: (view) => summarizeHighlightsCommand(view) },
      // Reset editor to fix performance issues
      { key: "Mod-Shift-r", run: () => { this.reset(); return true }}
      // Cmd+Shift+F is handled at document level in main.js to ensure it works
    ]
  }

  createTheme(type) {
    // Use CSS variables for both light and dark themes for consistency
    // The [data-theme='dark'] selector in CSS handles the color switching
    const isDark = type === 'dark'

    return EditorView.theme({
      "&": {
        color: "var(--editor-text-color, var(--editor-text))",
        backgroundColor: "var(--editor-bg-color, var(--editor-bg))",
        fontFamily: "var(--editor-font-family, 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif)",
        fontSize: "var(--editor-font-size, 16px)",
        lineHeight: "var(--editor-line-height, 1.7)"
      },
      ".cm-content": {
        color: "var(--editor-text-color, var(--editor-text))",
        caretColor: "var(--editor-caret-color, var(--editor-cursor))",
        padding: "var(--editor-padding, 24px 32px)"
      },
      "&.cm-focused .cm-cursor": {
        borderLeftColor: "var(--editor-caret-color, var(--editor-cursor))"
      },
      "&.cm-focused .cm-selectionBackground, ::selection": {
        backgroundColor: "var(--editor-selection-bg, var(--editor-selection))"
      },
      ".cm-selectionBackground": {
        backgroundColor: "var(--editor-selection-bg, var(--editor-selection))",
        borderRadius: "2px"
      },
      "&:not(.cm-focused) .cm-selectionBackground": {
        backgroundColor: "var(--editor-selection-bg, var(--editor-selection))"
      },
      ".cm-gutters": {
        backgroundColor: "var(--editor-gutter-bg, var(--editor-gutter))",
        color: "var(--editor-gutter-color, var(--editor-line-number))",
        border: "none",
        borderRight: "1px solid var(--editor-gutter-border, var(--border-primary))"
      },
      ".cm-activeLineGutter": {
        backgroundColor: "var(--editor-active-line-gutter-bg, var(--editor-active-line))"
      },
      ".cm-activeLine": {
        backgroundColor: "var(--editor-active-line-bg, var(--editor-active-line))"
      },
      ".cm-line": {
        color: "var(--editor-text-color, var(--editor-text))",
        paddingLeft: "var(--editor-line-padding, 4px)",
        paddingRight: "var(--editor-line-padding, 4px)"
      },
    }, { dark: isDark })
  }

  createFontSizeTheme(size) {
    console.log('Creating font size theme with size:', size);
    return EditorView.theme({
      "&": { fontSize: `${size}px` },
      ".cm-content": { fontSize: `${size}px` },
      ".cm-line": { fontSize: `${size}px` },
      ".cm-editor": { fontSize: `${size}px` }
    })
  }

  handleContentChange(update) {
    this.hasUnsavedChanges = true
    
    // Update word count immediately
    if (window.updateWordCount) {
      window.updateWordCount()
    }
    
    // Check if we're in the middle of a WikiLink completion
    const currentContent = this.view?.state?.doc?.toString() || '';
    const cursorPos = this.view?.state?.selection?.main?.head;
    const textBeforeCursor = currentContent.slice(Math.max(0, cursorPos - 10), cursorPos);
    
    // Check for WikiLink pattern - look for [[ without closing ]]
    const hasOpenWikiLink = textBeforeCursor.includes('[[') && 
                            !textBeforeCursor.includes(']]') &&
                            textBeforeCursor.lastIndexOf('[[') > textBeforeCursor.lastIndexOf(']]');
    
    // Debounce auto-save (extend delay; default 10s for normal editing)
    clearTimeout(this.autoSaveTimeout)
    const saveDelay = 10000; // 10 seconds for all editing scenarios
    
    if (hasOpenWikiLink) {
      console.log('WikiLink detected - keeping auto-save at 10 seconds');
    }
    
    this.autoSaveTimeout = setTimeout(() => {
      this.autoSave()
    }, saveDelay)
  }

  async setupTauriListeners() {
    // Any Tauri-specific setup can go here
  }

  clearInitialSelection() {
    // Position cursor after first line to show live preview instead of raw markdown
    setTimeout(() => {
      if (!this.view || !this.view.state) return;
      
      const doc = this.view.state.doc
      // If file starts with front matter (--- ... ---), skip it and place cursor after
      const firstLine = doc.line(1)
      if (firstLine.text.trim() === '---') {
        // Find the closing ---
        let fmEndLine = 1
        for (let i = 2; i <= Math.min(doc.lines, 200); i++) { // scan first 200 lines max
          const ln = doc.line(i)
          if (ln.text.trim() === '---') { fmEndLine = i; break }
        }
        const targetLineNum = Math.min(fmEndLine + 1, doc.lines)
        const targetLine = doc.line(targetLineNum)
        this.view.dispatch({ selection: { anchor: targetLine.from, head: targetLine.from } })
      } else if (doc.lines >= 2) {
        // Move cursor to start of second line so first line shows formatted
        const secondLine = doc.line(2)
        this.view.dispatch({ selection: { anchor: secondLine.from, head: secondLine.from } })
      } else if (doc.length > 0) {
        // If only one line, move to end of first line
        this.view.dispatch({ selection: { anchor: doc.length, head: doc.length } })
      }
      console.log('🔍 Editor initialized, double-click word selection should work now')
    }, 100)
  }

  // Content manipulation methods
  setContent(content, preserveScroll = false, filePath = null, preserveSelection = false) {
    const startTime = Date.now();
    // Parse frontmatter and keep only body in the editor buffer
    const parsed = this.parseFrontmatter(content || '')
    this.frontmatterRaw = parsed.raw
    this.frontmatterFields = parsed.fields
    const bodyOnly = parsed.body
    
    // Track performance for large content
    if (window.perfMonitor) {
      window.perfMonitor.trackEditorMetrics(this.editorId, 'set_content_start', startTime);
    }
    
    if (!this.view || !this.view.state) {
      console.error('[MarkdownEditor] Cannot set content - view not initialized');
      return;
    }
    
    // Preserve scroll position if requested
    let scrollTop = 0;
    let scrollLeft = 0;
    if (preserveScroll) {
      scrollTop = this.view.scrollDOM.scrollTop;
      scrollLeft = this.view.scrollDOM.scrollLeft;
    }
    
    // Set the current file path if provided
    const effects = [];
    if (filePath) {
      this.currentFile = filePath;
      effects.push(setCurrentFilePath.of(filePath));
    }
    
    this.view.dispatch({
      changes: {
        from: 0,
        to: this.view.state.doc.length,
        insert: bodyOnly
      },
      effects: effects.length > 0 ? effects : undefined
    });
    // Restore scroll position if it was preserved
    if (preserveScroll) {
      requestAnimationFrame(() => {
        this.view.scrollDOM.scrollTop = scrollTop;
        this.view.scrollDOM.scrollLeft = scrollLeft;
      });
    }
    
    // Track completion time
    if (window.perfMonitor) {
      window.perfMonitor.trackEditorMetrics(this.editorId, 'set_content_complete', startTime);
    }
    
    // Only set an initial cursor position on first loads; skip when preserving selection
    if (!preserveSelection) {
      setTimeout(() => {
        if (!this.view || !this.view.state) return;
        const doc = this.view.state.doc
        if (doc.lines >= 2) {
          const secondLine = doc.line(2)
          this.view.dispatch({ selection: { anchor: secondLine.from, head: secondLine.from } })
        } else if (doc.length > 0) {
          this.view.dispatch({ selection: { anchor: doc.length, head: doc.length } })
        }
      }, 50)
    }
    
    this.hasUnsavedChanges = false
  }

  getContent() {
    if (!this.view || !this.view.state) {
      console.warn('[MarkdownEditor] View not initialized yet');
      return '';
    }
    return this.view.state.doc.toString()
  }

  // Formatting methods
  toggleBold() {
    this.wrapSelection('**', '**')
  }

  toggleItalic() {
    this.wrapSelection('*', '*')
  }

  toggleHighlight() {
    this.wrapSelection('==', '==')
  }

  toggleUnderline() {
    this.wrapSelection('_', '_')
  }

  toggleStrikethrough() {
    this.wrapSelection('~~', '~~')
  }

  insertLink() {
    const selection = this.view.state.selection.main
    const selectedText = this.view.state.doc.sliceString(selection.from, selection.to)
    
    // Show link input dialog
    this.showLinkDialog(selectedText, selection)
  }
  
  showLinkDialog(selectedText, selection) {
    // Create modal overlay
    const overlay = document.createElement('div')
    overlay.className = 'link-dialog-overlay'
    overlay.innerHTML = `
      <div class="link-dialog">
        <h3>Insert Link</h3>
        <div class="link-dialog-field">
          <label>Link Text:</label>
          <input type="text" id="link-text" value="${selectedText}" placeholder="Enter link text">
        </div>
        <div class="link-dialog-field">
          <label>URL:</label>
          <input type="text" id="link-url" placeholder="Enter URL (e.g., https://example.com)">
        </div>
        <div class="link-dialog-buttons">
          <button id="link-cancel">Cancel</button>
          <button id="link-insert" class="primary">Insert Link</button>
        </div>
      </div>
    `
    
    // Add styles
    const style = document.createElement('style')
    style.textContent = `
      .link-dialog-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
      }
      
      .link-dialog {
        background: var(--bg-primary, #ffffff);
        border-radius: 8px;
        padding: 24px;
        width: 400px;
        max-width: 90vw;
        box-shadow: 0 10px 25px rgba(0, 0, 0, 0.2);
        border: 1px solid var(--border-color, #e9e9e7);
      }
      
      .link-dialog h3 {
        margin: 0 0 20px 0;
        color: var(--editor-text-color, #1f2937);
        font-size: 18px;
        font-weight: 600;
      }
      
      .link-dialog-field {
        margin-bottom: 16px;
      }
      
      .link-dialog-field label {
        display: block;
        margin-bottom: 6px;
        color: var(--text-secondary, #6b6b6b);
        font-size: 14px;
        font-weight: 500;
      }
      
      .link-dialog-field input {
        width: 100%;
        padding: 10px 12px;
        border: 1px solid var(--border-color, #e9e9e7);
        border-radius: 6px;
        font-size: 14px;
        color: var(--editor-text-color, #1f2937);
        background: var(--bg-primary, #ffffff);
        box-sizing: border-box;
      }
      
      .link-dialog-field input:focus {
        outline: none;
        border-color: var(--accent-color, #4572DE);
        box-shadow: 0 0 0 2px rgba(69, 114, 222, 0.1);
      }
      
      .link-dialog-buttons {
        display: flex;
        gap: 12px;
        justify-content: flex-end;
        margin-top: 24px;
      }
      
      .link-dialog-buttons button {
        padding: 8px 16px;
        border: 1px solid var(--border-color, #e9e9e7);
        border-radius: 6px;
        font-size: 14px;
        cursor: pointer;
        background: var(--bg-primary, #ffffff);
        color: var(--editor-text-color, #1f2937);
      }
      
      .link-dialog-buttons button.primary {
        background: var(--accent-color, #4572DE);
        color: white;
        border-color: var(--accent-color, #4572DE);
      }
      
      .link-dialog-buttons button:hover {
        opacity: 0.8;
      }
    `
    
    document.head.appendChild(style)
    document.body.appendChild(overlay)
    
    // Focus the appropriate input
    setTimeout(() => {
      const textInput = document.getElementById('link-text')
      const urlInput = document.getElementById('link-url')
      
      if (selectedText) {
        urlInput.focus()
      } else {
        textInput.focus()
        textInput.select()
      }
    }, 50)
    
    // Handle button clicks
    document.getElementById('link-cancel').onclick = () => {
      document.body.removeChild(overlay)
      document.head.removeChild(style)
      this.view.focus()
    }
    
    document.getElementById('link-insert').onclick = () => {
      const linkText = document.getElementById('link-text').value.trim()
      const linkUrl = document.getElementById('link-url').value.trim()
      
      if (linkText && linkUrl) {
        // Insert the markdown link
        this.view.dispatch({
          changes: {
            from: selection.from,
            to: selection.to,
            insert: `[${linkText}](${linkUrl})`
          },
          selection: {
            anchor: selection.from + linkText.length + linkUrl.length + 4, // Position after the link
            head: selection.from + linkText.length + linkUrl.length + 4
          }
        })
        
        document.body.removeChild(overlay)
        document.head.removeChild(style)
        this.view.focus()
        
        // Trigger content change for auto-save
        this.handleContentChange()
      }
    }
    
    // Handle Enter key in URL input
    document.getElementById('link-url').onkeydown = (e) => {
      if (e.key === 'Enter') {
        document.getElementById('link-insert').click()
      }
    }
    
    // Handle Escape key
    overlay.onkeydown = (e) => {
      if (e.key === 'Escape') {
        document.getElementById('link-cancel').click()
      }
    }
    
    // Close on overlay click
    overlay.onclick = (e) => {
      if (e.target === overlay) {
        document.getElementById('link-cancel').click()
      }
    }
  }

  wrapSelection(before, after) {
    if (!this.view) {
      console.error('No editor view available');
      return;
    }
    
    // Ensure editor has focus
    this.view.focus();
    
    const selection = this.view.state.selection.main
    const selectedText = this.view.state.doc.sliceString(selection.from, selection.to)
    
    this.view.dispatch({
      changes: {
        from: selection.from,
        to: selection.to,
        insert: before + selectedText + after
      },
      selection: {
        anchor: selection.from + before.length,
        head: selection.to + before.length
      }
    })
  }

  insertText(text) {
    const selection = this.view.state.selection.main
    this.view.dispatch({
      changes: {
        from: selection.from,
        to: selection.to,
        insert: text
      }
    })
  }

  // Line numbers toggle
  toggleLineNumbers() {
    this.showLineNumbers = !this.showLineNumbers
    this.view.dispatch({
      effects: this.lineNumbersCompartment.reconfigure(
        this.showLineNumbers ? [lineNumbers(), highlightActiveLineGutter(), foldGutter()] : []
      )
    })
    return this.showLineNumbers
  }
  
  // Set line numbers state
  setLineNumbers(enabled) {
    if (this.showLineNumbers !== enabled) {
      this.toggleLineNumbers()
    }
  }
  
  // Toggle line wrapping
  toggleLineWrapping() {
    this.lineWrapping = !this.lineWrapping
    this.view.dispatch({
      effects: this.lineWrappingCompartment.reconfigure(
        this.lineWrapping ? EditorView.lineWrapping : []
      )
    })
    return this.lineWrapping
  }
  
  // Set line wrapping state
  setLineWrapping(enabled) {
    if (this.lineWrapping !== enabled) {
      this.toggleLineWrapping()
    }
  }

  // Set WYSIWYG mode (true = enabled, false = raw markdown)
  setWysiwygMode(enabled) {
    this.wysiwygEnabled = enabled
    this.view.dispatch({
      effects: this.wysiwygCompartment.reconfigure(enabled ? [
        inlineFormattingExtension,
        inlineFormattingStyles,
        blockWidgetExtension
      ] : [])
    })
  }

  // Toggle WYSIWYG mode on/off
  toggleWysiwygMode() {
    this.setWysiwygMode(!this.wysiwygEnabled)
    return this.wysiwygEnabled
  }

  // Set font size
  setFontSize(size) {
    console.log('MarkdownEditor.setFontSize called with size:', size);
    if (this.view) {
      console.log('Dispatching font size change to editor view');
      try {
        this.view.dispatch({
          effects: this.fontSizeCompartment.reconfigure(
            this.createFontSizeTheme(size)
          )
        })
        console.log('Font size change dispatched successfully');
      } catch (error) {
        console.error('Error dispatching font size change:', error);
      }
    } else {
      console.warn('Editor view not available for font size change');
    }
  }

  // Force theme refresh (for font color changes)
  refreshTheme() {
    console.log('MarkdownEditor.refreshTheme called');
    if (this.view && this.themeCompartment) {
      try {
        // Determine current theme type
        const isDark = this.currentTheme === 'dark' || 
                      this.currentTheme === 'solarized-dark' || 
                      this.currentTheme === 'dracula';
        const themeType = isDark ? 'dark' : 'default';
        
        console.log('Refreshing theme with type:', themeType);
        
        // Force CodeMirror to recreate and apply the theme
        // This will re-read the CSS variables
        this.view.dispatch({
          effects: this.themeCompartment.reconfigure(
            this.createTheme(themeType)
          )
        });
        
        console.log('Theme refresh dispatched successfully');
        // Theme refreshed
      } catch (error) {
        console.error('Error refreshing theme:', error);
      }
    } else {
      console.warn('Editor view or theme compartment not available for theme refresh');
    }
  }

  // Save methods
  async save() {
    if (this.currentFile) {
      try {
        // Capture scroll position at the very start of save
        const initialScrollTop = this.view?.scrollDOM?.scrollTop || 0
        const initialScrollLeft = this.view?.scrollDOM?.scrollLeft || 0
        console.log(`💾 Saving file: ${this.currentFile} (scroll: top=${initialScrollTop}, left=${initialScrollLeft})`)
        const body = this.getContent()
        // Compose frontmatter + body for persistence
        const content = (this.frontmatterRaw || '') + body
        console.log('📝 Content length:', content.length)
        
        // Use absolute path for saving
        const absolutePath = this.currentFile.startsWith('/') || this.currentFile.includes(':') 
          ? this.currentFile 
          : `${window.currentVaultPath}/${this.currentFile}`;
        
        console.log('📝 Invoking write_file_content with absolute path:', absolutePath)
        
        let newTimestamp;
        try {
          newTimestamp = await invoke('write_file_content', {
            filePath: absolutePath,
            content: content
          })
          console.log('✅ write_file_content returned:', newTimestamp)
        } catch (writeError) {
          console.error('❌ write_file_content failed:', writeError)
          throw writeError
        }
        
        // IMPORTANT: Clear unsaved changes immediately after successful write
        // This must happen before any other async operations
        this.hasUnsavedChanges = false
        console.log('✅ File saved successfully, hasUnsavedChanges:', this.hasUnsavedChanges)
        
        // Notify tab system that file is saved (clear dirty state)
        // Use the original file path (relative) to match what the tab system stores
        if (window.onFileSaved) {
          console.log('📢 Notifying tab system, file saved:', this.currentFile)
          window.onFileSaved(this.currentFile)
        }
        
        // After saving, ensure all tasks have UUIDs persisted
        // Add a delay to ensure file write is fully flushed to disk
        await new Promise(resolve => setTimeout(resolve, 200))
        
        try {
          console.log('🔧 Calling batch_ensure_task_uuids with:', absolutePath)
          // Reuse the absolutePath we already computed above
          const taskUUIDs = await invoke('batch_ensure_task_uuids', {
            filePath: absolutePath
          })
          console.log('🔧 batch_ensure_task_uuids returned:', taskUUIDs)
          
          if (taskUUIDs && taskUUIDs.length > 0) {
            console.log(`✅ Ensured UUIDs for ${taskUUIDs.length} tasks in ${this.currentFile}`)
            
            // Dispatch event to update the task widget
            window.dispatchEvent(new CustomEvent('tasks-updated'))
            
            // Reload content to show the UUIDs that were added
            // Use absolute path to ensure we're reading the right file
            setTimeout(async () => {
              const updatedContent = await invoke('read_file_content', { 
                filePath: absolutePath
              })
              const currentCursor = this.view.state.selection.main.head
              this.setContent(updatedContent, false, this.currentFile, true)
              // Restore cursor
              this.view.dispatch({
                selection: { anchor: currentCursor, head: currentCursor }
              })
            }, 100)
          }
        } catch (error) {
          console.error('❌ Could not ensure task UUIDs after save:', error)
          // Don't let this error prevent the save from completing
        }
        
        // If a new timestamp was returned, update it in stored frontmatter (not the editor doc)
        if (newTimestamp) {
          // Update cached fields and raw YAML
          if (this.frontmatterFields.has('updated_at')) {
            this.frontmatterFields.set('updated_at', newTimestamp)
          }
          if (this.frontmatterRaw && this.frontmatterRaw.length) {
            this.frontmatterRaw = this.frontmatterRaw.replace(/\nupdated_at:\s*.*?\n/, `\nupdated_at: ${newTimestamp}\n`)
          }
        }

        // If the current buffer appears to contain a duplicated YAML header
        // (e.g., frontmatter block followed by another '---' + YAML in the body),
        // reload the canonical file content we just saved to disk to reflect backend sanitization.
        try {
          const hasLeading = content.startsWith('---\n') || content.startsWith('---\r\n')
          if (hasLeading) {
            const firstClose = content.indexOf('\n---\n', 4)
            const firstCloseCRLF = content.indexOf('\r\n---\r\n', 5)
            const closePos = firstCloseCRLF !== -1 ? firstCloseCRLF : firstClose
            if (closePos !== -1) {
              const extra = content.indexOf('\n---\n', closePos + 5)
              const extraCRLF = content.indexOf('\r\n---\r\n', (firstCloseCRLF !== -1 ? firstCloseCRLF : closePos) + 7)
              if (extra !== -1 || extraCRLF !== -1) {
                const updatedCanonical = await invoke('read_file_content', { filePath: absolutePath })
                const curPos = this.view?.state?.selection?.main?.head || 0
                this.setContent(updatedCanonical, true, this.currentFile, true)
                if (this.view) this.view.dispatch({ selection: { anchor: curPos, head: curPos } })
              }
            }
          }
        } catch (canonErr) {
          console.warn('Could not reload canonical content after save:', canonErr)
        }
        
        // Fallback: If no timestamp update was done, still ensure scroll position is preserved
        // This handles cases where the backend might not return a timestamp
        if (!newTimestamp && this.view) {
          const currentScrollTop = this.view.scrollDOM.scrollTop
          const currentScrollLeft = this.view.scrollDOM.scrollLeft
          if (currentScrollTop !== initialScrollTop || currentScrollLeft !== initialScrollLeft) {
            console.log(`⚠️ Scroll position changed during save without timestamp update. Restoring...`)
            this.view.scrollDOM.scrollTop = initialScrollTop
            this.view.scrollDOM.scrollLeft = initialScrollLeft
          }
        }
        
        // Dispatch file-saved event for other components (like TaskWidget)
        // Use absolute path for widget updates
        window.dispatchEvent(new CustomEvent('file-saved', { 
          detail: { filePath: absolutePath }
        }))
        
        // Manually sync tasks to index if this file contains tasks
        if (content.includes('- [ ]') || content.includes('- [x]')) {
          console.log('[Editor] Full path for sync:', absolutePath);
          await this.syncTasksToIndex(absolutePath)
        }
      } catch (error) {
        console.error('❌ Failed to save file:', error)
      }
    }
  }

  async autoSave() {
    // Additional check - don't save if WikiLink is still open
    const currentContent = this.view?.state?.doc?.toString() || '';
    const cursorPos = this.view?.state?.selection?.main?.head;
    const textBeforeCursor = currentContent.slice(Math.max(0, cursorPos - 10), cursorPos);
    
    const hasOpenWikiLink = textBeforeCursor.includes('[[') && 
                            !textBeforeCursor.includes(']]') &&
                            textBeforeCursor.lastIndexOf('[[') > textBeforeCursor.lastIndexOf(']]');
    
    if (hasOpenWikiLink) {
      console.log('Skipping auto-save - WikiLink still open');
      // Reschedule for later (10 seconds)
      clearTimeout(this.autoSaveTimeout)
      this.autoSaveTimeout = setTimeout(() => {
        this.autoSave()
      }, 10000)
      return;
    }
    
    if (this.hasUnsavedChanges && this.currentFile) {
      await this.save()
    }
  }

  togglePreview() {
    // Preview functionality can be implemented later
    console.log('Preview toggle not implemented yet')
  }

  // Open search panel
  openSearch() {
    if (this.view) {
      // Open panel and ensure replace UI is available
      openSearchPanel(this.view)
      const state = this.view.state
      const sel = state.selection.main
      const selectedText = sel.empty ? '' : state.sliceDoc(sel.from, sel.to)

      // Preserve existing query (if any) and ensure replace is present
      const existing = getSearchQuery(state)
      const query = new SearchQuery({
        search: selectedText || existing.search || '',
        caseSensitive: existing.caseSensitive,
        regexp: existing.regexp,
        wholeWord: existing.wholeWord,
        replace: typeof existing.replace === 'string' ? existing.replace : ''
      })
      this.view.dispatch({ effects: setSearchQuery.of(query) })
    }
  }
  
  // Close search panel
  closeSearch() {
    if (this.view) {
      closeSearchPanel(this.view);
    }
  }

  // Utility methods
  focus() {
    this.view.focus()
  }
  
  async reset() {
    console.log('🔄 Resetting CodeMirror editor instance');
    
    // Check if user wants to save unsaved changes
    if (this.hasUnsavedChanges && this.currentFile) {
      const shouldSave = confirm('You have unsaved changes. Save before resetting?');
      if (shouldSave) {
        await this.save();
      }
    }
    
    // Save current content and cursor position
    const content = this.getContent();
    const cursorPos = this.view?.state.selection.main.head || 0;
    const scrollPos = this.view?.scrollDOM.scrollTop || 0;
    
    // Clear all timeouts
    if (this.autoSaveTimeout) clearTimeout(this.autoSaveTimeout);
    if (this.settingsTimeout) clearTimeout(this.settingsTimeout);
    
    // Clear caches
    if (window.wikiLinkCache) {
      window.wikiLinkCache.invalidateAll();
    }
    
    // Clear note existence cache from wikilink extension
    if (window.noteExistenceCache) {
      window.noteExistenceCache.clear();
    }
    
    // Destroy current view
    if (this.view) {
      this.view.destroy();
      this.view = null;
    }
    
    // Clear container
    this.container.innerHTML = '';
    
    // Small delay to ensure cleanup
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Recreate editor with same content
    this.setupEditor(content);
    
    // Restore cursor position and scroll
    setTimeout(() => {
      if (this.view) {
        this.view.dispatch({
          selection: { anchor: cursorPos, head: cursorPos },
          scrollIntoView: true
        });
        this.view.scrollDOM.scrollTop = scrollPos;
      }
    }, 50);
    
    // Show notification
    this.showNotification('Editor reset successfully');
    
    console.log('✅ Editor reset complete');
  }
  
  showNotification(message) {
    // Add animation style if not already present
    if (!document.querySelector('#editor-notification-styles')) {
      const style = document.createElement('style');
      style.id = 'editor-notification-styles';
      style.textContent = `
        @keyframes slideIn {
          from {
            transform: translateX(100%);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
      `;
      document.head.appendChild(style);
    }
    
    const notification = document.createElement('div');
    notification.className = 'editor-notification';
    notification.textContent = message;
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: #4a90e2;
      color: white;
      padding: 10px 20px;
      border-radius: 4px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.2);
      z-index: 10000;
      animation: slideIn 0.3s ease-out;
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
      notification.style.opacity = '0';
      notification.style.transition = 'opacity 0.3s ease-out';
      setTimeout(() => notification.remove(), 300);
    }, 3000);
  }

  async syncTasksToIndex(filePath) {
    // Define pathToSync outside try block so it's accessible in catch
    const pathToSync = filePath || this.currentFile;
    
    try {
      console.log('[Editor] Syncing tasks to index for:', filePath)
      console.log('[Editor] Current file:', this.currentFile)
      console.log('[Editor] Window vault path:', window.currentVaultPath)
      console.log('[Editor] Path to sync:', pathToSync)
      
      const result = await invoke('sync_file_tasks_to_index', { 
        filePath: pathToSync
      })
      console.log('[Editor] Task sync completed, result:', result)
      
      // Dispatch event to notify TaskWidget
      window.dispatchEvent(new Event('tasks-updated'))
    } catch (error) {
      console.error('[Editor] Failed to sync tasks to index:', error)
      console.error('[Editor] Attempted path was:', pathToSync)
    }
  }

  destroy() {
    console.log(`🧹 Destroying MarkdownEditor instance: ${this.editorId}`);
    
    // Track destruction performance
    const startTime = Date.now();
    if (window.perfMonitor) {
      window.perfMonitor.trackEditorMetrics(this.editorId, 'destruction', startTime);
    }
    
    // Clear any pending auto-save
    if (this.autoSaveTimeout) {
      clearTimeout(this.autoSaveTimeout);
      this.autoSaveTimeout = null;
    }
    
    // Clear any pending timeouts for settings
    if (this.settingsTimeout) {
      clearTimeout(this.settingsTimeout);
      this.settingsTimeout = null;
    }
    
    // Remove any event listeners that might have been added
    if (this.container) {
      // Remove any custom event listeners from the container
      this.container.removeEventListener('click', this.handleClick);
      this.container.removeEventListener('keydown', this.handleKeyDown);
      this.container.classList.remove('markdown-editor-boxnote-converted');
    }
    
    // Clear references to prevent memory leaks
    this.currentFile = null;
    this.customThemes.clear();
    this.container = null;
    
    // Destroy the CodeMirror view
    if (this.view) {
      this.view.dom.classList.remove('cm-boxnote-converted');
      this.view.destroy();
      this.view = null;
    }
    
    console.log('✅ MarkdownEditor destroyed');
  }
}
