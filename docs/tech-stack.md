# Tech Stack

## Runtime

- **Tauri 2** for the desktop shell and IPC boundary.
- **Rust 2021** for privileged backend logic.
- **Vanilla JavaScript ES modules** for the main frontend.
- **Vite 6** for development and production bundling.
- **React 19** only for the lazy-loaded Botcky chat island.

## Frontend Libraries

- **CodeMirror 6** for markdown editing and custom editor extensions.
- **PDF.js (`pdfjs-dist`)** for PDF viewing.
- **xterm.js** for terminal UI.
- **date-fns** for frontend date formatting.
- **Fuse.js** for fuzzy matching.
- **Zod** for runtime validation in selected frontend flows.
- **Lucide SVG assets** checked into `src/icons/lucide/` and wrapped by `src/icons/icon-utils.js`.

## Rust Libraries

- **tokio** for async runtime support.
- **serde / serde_json / serde_yaml** for serialization and frontmatter parsing.
- **reqwest 0.12** for HTTP calls and streaming.
- **base64 0.22** for direct app base64 encoding/decoding.
- **keyring** for OS credential storage.
- **ed25519-dalek** for signed license payload verification.
- **portable-pty** for PTY integration.
- **tracing / tracing-subscriber / tracing-appender** for structured app logs.
- **notify / notify-debouncer-full / walkdir** for filesystem monitoring and traversal.
- **rusqlite bundled** for local structured storage where needed.
- **pdf-extract / pdfium-render** for PDF text extraction paths.
- **specta**, pinned to `=2.0.0-rc.22`, for selected TypeScript type generation.

## Project Layout

- `src/`: frontend modules, styles, tests, and browser-facing assets.
- `src-tauri/src/`: Rust app code and command handlers.
- `src-tauri/tests/`: Rust integration tests.
- `test/`: Jest configuration, setup, lint tests, and shared test helpers.
- `tests/`: tracked legacy unit tests that were triaged into the default Jest run.
- `public/excalidraw-bundle/`: independent Vite package for Excalidraw assets.
- `docs/`: public contributor-facing documentation.
- `.docs/`: private/internal working documents, ignored by git.

## Build And Test Tooling

- **npm** manages the root frontend toolchain.
- **Cargo** manages the Rust/Tauri backend.
- **Jest 30 + jsdom** is the app test runner.
- **ESLint flat config** enforces unsafe-HTML and empty-catch rules.
- **Prettier** formats JS, CSS, Markdown, and JSON.
- **rustfmt** formats Rust.
- **clippy with `-D warnings`** is the Rust lint gate.

## Local Data

- Notes are plain Markdown files in user-selected vault folders.
- Markdown identity metadata is stored in frontmatter.
- Non-Markdown identity metadata uses sidecar JSON files.
- Secrets are stored in the OS keychain.
- Logs are written to the platform app log directory, for example `~/Library/Logs/com.vault.app/` on macOS.
