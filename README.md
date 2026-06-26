# Vault

> A local-first notes and knowledge app. Everything you save - notes, highlights, PDFs, sketches, tasks - stays as plain Markdown on your own disk and compounds into private, reusable context for the AI of your choice. Nothing leaves your machine until you say so.

[![Release](https://img.shields.io/github/v/release/k3snyder/vault?sort=semver)](https://github.com/k3snyder/vault/releases)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)
[![Platform: macOS](https://img.shields.io/badge/platform-macOS-black?logo=apple)](#download)
[![CI](https://github.com/k3snyder/vault/actions/workflows/ci.yml/badge.svg)](https://github.com/k3snyder/vault/actions/workflows/ci.yml)
[![Built with Rust](https://img.shields.io/badge/Rust-stable-orange?logo=rust)](https://www.rust-lang.org/)
[![Tauri 2](https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri)](https://tauri.app/)

A **Rust + Tauri desktop app** for local-first knowledge management. Most note apps make you trade privacy for AI, or AI for privacy; Vault keeps your vault as **plain Markdown on your own disk** and still treats it as a first-class workspace for AI. Every note, highlight, and document compounds into context you can hand to a local or cloud model - and nothing is sent automatically.

## Why Vault

- 🧠 **Progressive context** - every note, highlight, and document compounds into reusable AI context, so your knowledge base gets sharper the more you write. You choose what's shared; nothing leaves automatically.
- 🔒 **Local-first and private** - plain Markdown files on your filesystem. Zero telemetry, zero cloud dependency, zero lock-in, and no unsolicited network requests.
- 🔌 **Bring your own model** - OpenAI, Claude, and Gemini, or fully offline with Ollama / LM Studio. API keys live in the OS keychain, never in plaintext.
- 🤖 **CLI agents with vault context** - run Claude Code, Codex, and Gemini CLI agents against your vault from an integrated terminal.
- 📄 **More than notes** - highlight PDFs into Markdown, view/edit CSV and JSON, open and convert Box `.boxnote` files, sketch in embedded Excalidraw, and export to Word / HTML / PDF.
- 🆔 **Built to last** - stable UUIDv7 identity survives renames, moves, and sync; `[[WikiLinks]]` connect everything; native Rust + Tauri speed keeps pace with how you think.

## Table of Contents

- [Download](#download)
- [Quick Start (from source)](#quick-start-from-source)
- [How It Works](#how-it-works)
- [Example Note](#example-note)
- [Requirements](#requirements)
- [Configuration](#configuration)
- [Usage Details](#usage-details)
- [Keyboard Shortcuts](#keyboard-shortcuts)
- [Development](#development)
- [Project Structure](#project-structure)
- [Tech Stack](#tech-stack)
- [Status & Scope](#status--scope)
- [License](#license)

## Download

Grab the latest macOS build from the **[Releases page](https://github.com/k3snyder/vault/releases)**.

No public release yet - until the first build is published, [build from source](#quick-start-from-source) below. It takes a couple of commands.

## Quick Start (from source)

```bash
git clone https://github.com/k3snyder/vault.git
cd vault
npm ci
npm ci --prefix public/excalidraw-bundle
npm run tauri:dev
```

Requires Rust (stable), Node.js 22+, and npm 10+ - see [Requirements](#requirements). Your notes stay on the local filesystem; AI features only reach the network when you explicitly invoke a provider.

## How It Works

Vault is a Tauri desktop app: a vanilla-JavaScript UI in the webview, with all privileged work behind Rust commands.

```text
UI: editor, file tree, AI chat, terminal, plugin hub
        │  Tauri IPC commands + events
        ▼
Rust backend: vault I/O, identity, tasks, PTY,
              PDF/CSV, AI settings, plugin runtime
        │
        ▼
Local resources + explicit integrations:
  Markdown vaults, sidecar JSON, OS keychain,
  configured AI providers, CLI agent processes
```

Each note is a plain `.md` file. Stable identity and task metadata live in YAML frontmatter (with sidecar JSON where needed), so links and tasks survive renames, moves, and sync. The network is touched only when you invoke an AI provider, export, or plugin. Full detail in [docs/architecture.md](docs/architecture.md).

## Example Note

A Vault note is just Markdown you could read in any editor - the frontmatter is what makes it AI- and database-friendly:

```markdown
---
id: 0192f0c4-7e3a-7c11-9b2e-9f1d3a5b7c20   # UUIDv7, stable across renames & sync
title: Project Atlas
tags: [research, ai]
---

# Project Atlas

Linked to [[Meeting Notes 2026-06-20]] and tracked by [[tid:01933b2a-9f1d-7c11]].

- [ ] Draft the architecture brief #task
```

Because identity lives in the frontmatter rather than the filename, `[[WikiLinks]]` and tasks keep resolving after you rename or move the file - which is exactly what makes a note safe to feed to AI or index in a database.

## Requirements

**Core (to build from source):**

- Rust (stable)
- Node.js 22+
- npm 10+

**Bundled / automatic:**

- PDFium (via `pdfium-render`) and SQLite (bundled `rusqlite`) - no manual install needed.

**Optional:**

- An AI provider - cloud (OpenAI / Claude / Gemini) or local (Ollama / LM Studio).
- CLI agents - Claude Code, Codex, or Gemini CLI for in-terminal agent workflows ([install](#cli-agents-optional)).

<details>
<summary><strong>CLI agents</strong> (optional, for in-terminal agent workflows)</summary>

```bash
# Claude Code
npm install -g @anthropic-ai/claude-code

# Codex CLI
npm install -g @openai/codex
```

Gemini CLI is installed per Google's instructions. Once an agent is on your `PATH`, run it from Vault's integrated terminal and it operates with full vault context.

</details>

## Configuration

### AI Providers

Vault talks to multiple model backends. Pick cloud, local, or both:

| Provider | Use |
|----------|-----|
| OpenAI / OpenAI-compatible | Cloud chat + agents |
| Anthropic Claude (incl. Bedrock) | Cloud chat + agents |
| Google Gemini | Cloud chat + agents |
| Ollama / LM Studio | Fully local, offline |
| Claude Code / Codex / Gemini CLI | Integrated terminal agents with vault context |

API keys are stored in the OS keychain, and vault context is assembled only for the workflow you explicitly invoke.

### Local AI (offline)

For a fully offline setup, run a local server and point Vault's AI settings at it:

- **Ollama** - `ollama serve` (default `http://localhost:11434`)
- **LM Studio** - start its local OpenAI-compatible server and use that base URL

Select the local provider in AI settings and no request ever leaves your machine.

## Usage Details

Notes live in the vault folder you choose - just Markdown plus sidecar JSON for identity and task indexes. AI keys and plugin secrets are kept in the OS keychain, and app logs are written locally for bug reports. You can open multiple vaults in separate windows at once.

<details>
<summary><strong>Full feature list</strong></summary>

- **Progressive Context** - notes, highlights, and documents compound into evolving AI context; you control what is shared.
- **Local-first storage** - plain Markdown files, no lock-in, no tracking.
- **Multi-model AI** - OpenAI, Claude, Gemini, Ollama, LM Studio.
- **CLI AI agents** - Claude Code, Codex, and Gemini CLI with full vault context.
- **UUID identity** - stable note and task identity (UUIDv7) in frontmatter, preserved across renames, moves, and sync.
- **WikiLinks** - `[[note]]` and `[[tid:xxx]]` linking with auto-completion.
- **Task management** - central dashboard to edit/view all tasks across notes, with list, kanban, and calendar views.
- **Plugin system** - extensible architecture with permission controls and sandboxing.
- **Multi-vault windows** - work with multiple vaults simultaneously.
- **Native PDF support** - view and highlight PDFs; extract highlights into Markdown notes for AI context.
- **Box.com Boxnote** - open a vault from a Box Sync folder; view `.boxnote` documents and convert to Markdown in one click.
- **CSV support** - view/edit CSV files; define a schema and extract AI context for workflows.
- **JSON support** - view/edit JSON files.
- **Excalidraw integration** - embedded Excalidraw to view, edit, and create sketches; save a diagram as an image for AI context.
- **Rich export** - Markdown to Word, HTML, or PDF with full syntax support (highlights, headings, bullets, and more).

See [docs/features.md](docs/features.md) for the contributor-oriented feature map.

</details>

<details>
<summary><strong>Plugins</strong></summary>

Plugins extend Vault through a permission-checked, sandboxed runtime with settings, vault, workspace, and network APIs. Permissions are validated per plugin, and TypeScript API types are generated for plugin authors. Open the Plugin Hub with `Cmd+Shift+P`.

</details>

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+F` | Global search |
| `Cmd+N` | New note |
| `Cmd+W` | Close tab |
| `Cmd+T` | New task |
| `Cmd+Shift+T` | New tab |
| `Cmd+Shift+P` | Plugin Hub |
| `[[` | WikiLink autocomplete |

## Development

```bash
# Frontend checks
npm ci
npm ci --prefix public/excalidraw-bundle
npm run lint
npm run format:check
npm run build
```

Rust checks run from `src-tauri/`:

```bash
cd src-tauri
cargo fmt --check
cargo clippy -- -D warnings
cargo build
```

<details>
<summary><strong>CI</strong></summary>

CI (`.github/workflows/ci.yml`) runs on every push and pull request on a macOS runner (Node 22 + Rust stable): ESLint, Prettier `format:check`, the frontend `build`, then `cargo fmt --check`, `cargo clippy -- -D warnings`, and `cargo build` in `src-tauri/`.

</details>

<details>
<summary><strong>Build a release bundle</strong></summary>

```bash
npm run tauri:build
```

This produces the macOS `.app` / `.dmg` under `src-tauri/target/release/bundle/`.

</details>

<details>
<summary><strong>Release process</strong></summary>

Releases use `vX.Y.Z` git tags and keep all manifests on the same semantic version. The version lives in `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json` (all currently `0.1.0`).

1. Bump the version in all three manifests to match the tag.
2. Run the verification gates (frontend + Rust, above).
3. Build the bundle with `npm run tauri:build`.
4. Commit, then create the annotated tag: `git tag -a vX.Y.Z -m "vX.Y.Z"`.
5. Publish a GitHub release for the tag and **attach the `.dmg`** so the Download link resolves.

</details>

## Project Structure

```
.
├── src/                      # Vanilla JS frontend (editor, chat, tasks, pdf, csv, plugins)
├── src-tauri/                # Rust backend (vault I/O, identity, tasks, PTY, plugin runtime)
│   ├── src/
│   └── Cargo.toml
├── public/                   # Static assets + bundled Excalidraw
├── plugins/                  # Bundled plugins (e.g. readwise)
├── docs/                     # Architecture, features, tech stack
└── .github/workflows/ci.yml  # Frontend + Rust CI gates
```

## Tech Stack

- **Desktop**: Tauri 2, vanilla JavaScript (React isolated to one lazy-loaded chat island), Vite 6
- **Editor**: CodeMirror 6, xterm.js terminal, embedded Excalidraw, pdf.js
- **Backend**: Rust (2021 edition), Tokio, `rusqlite` (bundled SQLite), `pdfium-render`
- **AI**: OpenAI-compatible, Anthropic Claude (incl. Bedrock), Google Gemini, Ollama / LM Studio; Claude Code / Codex / Gemini CLI agents
- **Storage**: Local filesystem (Markdown + sidecar JSON), OS keychain for secrets

## Status & Scope

Vault is in active development at `0.1.0` and is a **local-first desktop app for a single workstation**. With a local model (Ollama / LM Studio) it runs fully offline, keeping notes and model output on your machine; cloud providers are optional.

- **Supported platform**: macOS. The app uses macOS-private APIs and native window decorations, and CI builds and tests on macOS.
- **Windows / Linux**: not yet built or verified.
- **Privacy**: zero telemetry and no unsolicited network requests; AI and export are explicit, user-driven actions.

## License

[AGPL-3.0-only](LICENSE) © Vault Contributors
