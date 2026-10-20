# Changelog

All notable changes to the OpenChat extension are documented here.

## [0.1.0] - 2026-10-20

### Added

- Session list is now scoped to the current workspace (only sessions from the open folder are shown).
- Rename sessions from the panel (✏️ button next to the session picker).
- "Thinking" indicator while the model is working.
- Toggle to show or hide the model's reasoning ("Thinking" button).
- Diagnostics in the **OpenChat** output channel (server URL, init summary, prompts, event stream).

### Fixed

- Sending a message with no active session was silently ignored; it now creates a session on the fly or reports a clear error.

## [0.0.1] - 2026-10-19

### Added

- Native chat panel in the Activity Bar with automatic editor context (active file, cursor line and selection).
- Attach files to a prompt via the 📎 button (sent as real file parts).
- Session management: list, create, switch and delete.
- Model and agent selection per session.
- Streaming responses with markdown rendering, code copy/insert and file links.
- Changed-files panel with side-by-side diff.
- Session revert and permission prompts.
- CLI pre-validation: checks that OpenCode is installed and is v2 before starting the server.

### Changed

- Migrated from the OpenCode v1 HTTP API to the v2 API (`/api/*`) with Basic auth.
- Replaced the OpenCode SDK client with a small built-in HTTP client based on `node:http`.
