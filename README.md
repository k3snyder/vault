# Vault

A local-first notes app that brings together everything you've saved, highlighted, or written — private, fast, AI-ready. 

## Features

- **Progressive Context** — Every note, highlight, and document compounds into deeper AI context, building a continuously evolving knowledge engine. You control what to share with local or cloud AI, nothing is sent automatically.
- **Local app performance** - Native desktop performance that keeps pace with how you think. A knowledge engine that responds the moment you do. Built for professionals who refuse to wait.
- **Local-First Storage** — Plain Markdown files. No lock-in. No tracking. 
- **Multi-Model AI** — OpenAI, Claude, Gemini, Ollama, LM Studio
- **CLI AI Agents** — Integrated Claude Code, Codex, Gemini CLI AI Agents with full vault context and MCP integration
- **UUID Identity** — Stable note and task identity (UUIDv7) Frontmatter preserved across renames, moves, and sync. Critical for AI & Database integration. 
- **MCP Native** — Model Context Protocol for AI agent workflows. Ability to setup and integrate to any MCP service. 
- **WikiLinks** — `[[note]]` and `[[tid:xxx]]` linking with auto-completion
- **Task Management** — Central Task management with ability to edit/view all tasks across notes
- **Plugin System** — Extensible architecture with permission controls
- **Multi-Vault Windows** — Work with multiple vaults simultaneously
- **Native PDF Support** - Ability to view and highlight PDFs. Extract highlights into markdown notes and leverage for enhanced AI context. 
- **Box.com Boxnote** - Open Vault from Box Sync folder. Ability to view .boxnote documents and one button convert to markdown. 
- **CSV Support** - View / Edit CSV files. Enhanced AI Context plugin to define CSV schema and extract AI context as context for AI workflows.  
- **JSON Support** - View / Edit JSON files. 
- **Excalidraw Integration** - embedded Excalidraw support to open view / edit / create sketeches and diagrams. Ability to save diagram as image for AI context. 
- **Word Doc / HTML / PDF Export Support** - export from markdown note to feature rich Doc, HTML or PDF documents with full syntax support such as highlights, headings, bullets, etc. 

## Privacy

Every note is plain Markdown text with total control, stored wherever you choose. Local-first architecture means your thoughts never leave your machine unless you say so. **Zero telemetry. Zero cloud dependency. Zero lock-in.**

Vault makes zero unsolicited network requests.

AI is your choice: Use cloud providers (OpenAI, Claude, Gemini) or stay fully local with Ollama/LM Studio. Vault never sends data without your explicit action.

## Quick Start

**Requirements:** Rust 2021+, Node.js 22+, npm 10+

```bash
git clone https://github.com/vault/vault.git
cd vault
npm install
npm run tauri dev
```

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+F` | Global search |
| `Cmd+N` | New note |
| `Cmd+W` | Close tab |
| `Cmd+T` | New Task |
| `Cmd+Shift+T` | New tab |
| `Cmd+Shift+P` | Plugin Hub |
| `[[` | WikiLink autocomplete |

## Tech Stack

- **Backend:** Rust, Tauri v2
- **Frontend:** Vanilla JS, CodeMirror 6, xterm.js
- **Storage:** Local filesystem (Markdown + JSON)
- **AI:** OpenAI-compatible API, Anthropic, Google AI, Ollama, LM Studio

## License

[APGLv3](LICENSE)
