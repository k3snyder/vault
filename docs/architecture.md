# Architecture

Vault is a local-first Tauri desktop app. The frontend is vanilla JavaScript rendered in a Tauri webview, and privileged work runs behind Rust Tauri commands. Notes and user data stay on the local filesystem unless a user explicitly invokes an AI provider, export, plugin, or network-enabled workflow.

## Layers

```text
UI components and editors
  CodeMirror, file tree, widgets, AI chat, terminal, plugin hub
        |
        | Tauri IPC commands and events
        v
Rust backend modules
  vault, editor, identity, tasks, license, plugin_runtime, PTY,
  PDF intelligence, CSV, AI settings, logging, window lifecycle
        |
        v
Local resources and explicit integrations
  Markdown vaults, sidecar JSON, OS keychain, app logs,
  configured AI providers, CLI agent processes, plugin assets
```

There is no bundled MCP service layer in the current app. CLI agent workflows and Botcky tools use Tauri commands, PTY sessions, vault-scoped direct tools, and provider-specific adapters.

## Frontend

- `src/main.js` still owns the app bootstrap and some legacy wiring.
- `src/app/AppContext.js` carries shared app state for newer modules.
- `src/app/file-tree.js` owns visible row computation, incremental rendering, and virtualization for larger vaults.
- `src/editor/` contains CodeMirror extensions for markdown editing, live preview, task rendering, image handling, wikilinks, and formatting controls.
- `src/chat/` contains provider adapters and the main chat panel.
- `src/botcky/` is the isolated React island for native Botcky chat. It is lazy-loaded so React is not in the initial app chunk.
- `src/widgets/`, `src/tasks/`, `src/pdf/`, `src/csv/`, `src/boxnote/`, and `src/plugin-hub/` contain feature-specific UI modules.

## Backend

The Rust entry point is `src-tauri/src/main.rs`, which registers Tauri command handlers and initializes app-wide services.

Key backend modules:

- `vault.rs`: vault-scoped filesystem operations and path safety.
- `identity/`: UUIDv7 note/task identity, frontmatter parsing, sidecars, migration helpers, and watcher support.
- `tasks/` and `commands/task_*`: task index and task command handlers.
- `license/` and `commands/license.rs`: signed license payload validation and trial state.
- `plugin_runtime/`: plugin lifecycle, sandboxing, permissions, IPC, APIs, validation, and TypeScript type generation.
- `commands/pty.rs`: PTY session spawn/write/resize/close with audit logging.
- `botcky/`: vault-root-safe direct tools and shell allowlist for Botcky workflows.
- `pdf_intelligence/`, `pdf_export.rs`, and `csv/`: document and structured-data processing.
- `logging.rs`: app log file initialization and frontend log forwarding.

## Data Flow

Read path:

1. A UI module requests data through a Tauri command.
2. Rust validates paths and arguments.
3. Rust reads local files, sidecars, settings, or keychain-backed state.
4. The command returns serializable data to the frontend.

Write path:

1. UI modules debounce or batch user edits where appropriate.
2. Rust command handlers validate paths and payloads.
3. Files are written atomically where the module supports it.
4. File watcher events and frontend events refresh affected UI surfaces.

AI path:

1. The user configures and explicitly invokes an AI provider or local model.
2. Provider adapters stream responses through the frontend.
3. API keys are stored in the OS keychain rather than plaintext settings.
4. Vault context is assembled only for the invoked workflow.

## Security Model

- The frontend has no direct filesystem authority outside Tauri APIs.
- Rust path validation prevents traversal and symlink escape for vault-scoped tools.
- AI and image-fetch network access is policy gated.
- API keys and plugin secrets use OS keychain storage.
- Plugin APIs are permission checked and sandboxed.
- PTY spawn events are audit logged with command, args, cwd, and environment key names only, not environment values.
- Rendered HTML sinks are guarded by lint rules and escaping helpers for new code.

## Performance Notes

- Large file trees use visible-row computation and virtualization.
- File watcher bursts are coalesced before refresh.
- Heavy filesystem command work is moved off the async runtime where needed.
- React is isolated to the Botcky island and split into a lazy chunk.
- Rust tests run serially in CI to avoid shared-state flakes that are still quarantined.
