# Features

This page describes the features present in the current app codebase. It is a contributor map, not a product roadmap.

## Notes And Editing

- Markdown editing with CodeMirror 6.
- Live preview and WYSIWYG-style formatting extensions.
- WikiLinks with `[[note]]` syntax.
- Task syntax and task checkbox rendering.
- Floating formatting toolbar and slash command menu.
- Image paste and local image reference handling.
- Frontmatter preservation during identity and task updates.

## Navigation

- Multi-tab editor interface.
- Split-pane editing through `PaneManager`.
- Virtualized and incrementally rendered file tree for large vaults.
- Recent vault and multi-window support.
- Global search UI and note-related navigation helpers.

## Tasks

- Cross-note task dashboard with list, kanban, and calendar views.
- Sidebar task widget.
- Rust task indexing and query commands.
- Stable task IDs using the identity system.
- Toggle and source-resolution commands that keep open editors in sync where possible.

## AI And Agents

- Streaming chat panel with provider adapters.
- Providers include OpenAI-compatible endpoints, Google Gemini, Anthropic Claude, Bedrock Claude, Ollama/LM Studio style local endpoints, and the native Botcky gateway path.
- API keys are stored in the OS keychain.
- CLI/terminal workflows run through PTY integration.
- Botcky direct tools are vault-root scoped and use explicit path validation.

## Documents And Data

- PDF viewing and PDF tab support.
- PDF intelligence extraction for text, tables, images, and metadata.
- Markdown export for extracted PDF intelligence.
- CSV viewing/editing and schema/context helpers.
- Box Note viewing and conversion support.
- Markdown, HTML, PDF, and Word-oriented export paths.
- Excalidraw bundle integration for sketches and diagrams.

## Plugins

- Plugin hub UI.
- Plugin lifecycle and validation.
- Permission checks and sandbox/CSP helpers.
- Plugin settings, vault, workspace, and network APIs.
- Resource monitoring and TypeScript API type generation.

## Security And Privacy

- Local-first vault storage.
- No telemetry path in the app.
- Network access is explicit and provider/user driven.
- OS keychain storage for AI keys and plugin secrets.
- Signed license payload verification.
- Path traversal and symlink escape protections in vault-scoped commands.
- PTY spawn audit logging without environment values.

## Developer Experience

- GitHub Actions CI for frontend and Rust gates.
- Jest default suite with the app task tests converted from Vitest.
- ESLint, Prettier, rustfmt, and clippy gates.
- Structured frontend-to-Rust logging for bug reports.
