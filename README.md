# OpenChat

**OpenCode GUI for VSCode.**

A native chat panel for [OpenCode](https://opencode.ai) inside VS Code, with automatic editor context (active file, cursor line and selection).

OpenCode GUI talks to a locally running OpenCode server, so you get the full agent experience — tools, diffs, sessions and models — without leaving the editor.

## Features

- **Native chat panel** in the Activity Bar (`OpenChat` icon).
- **Editor context**: the active file, cursor line and selection are attached automatically, or as an explicit `@path#Lx-y` reference.
- **Attach files**: click the 📎 button in the composer to attach any files; they are sent to the model as real file parts.
- **Sessions**: list, create, switch, rename and delete sessions. Only sessions from the current workspace are shown.
- **Models & agents**: pick a model (grouped by provider) and an agent per session.
- **Thinking**: a live indicator while the model works, plus a toggle to show or hide the model's reasoning.
- **Streaming responses** with markdown rendering, copy/insert code actions and file links.
- **Changed files**: see the diff of files the agent edited and open them side by side.
- **Revert**: roll a session back to before a given message.
- **Permissions**: allow once / always / reject from the panel.

## Requirements

- **OpenCode CLI v2** installed and available on your `PATH` (or configured via `openchat.opencodePath`).
  The extension runs `opencode serve` under the hood and talks to its v2 HTTP API.
- A configured **provider / API key** for OpenCode (the model dropdown lists whatever the server exposes).

> The v1 HTTP API is no longer supported. If the CLI is missing or older than v2, the panel shows a clear message instead of starting.

## Getting started

1. Install the OpenCode CLI v2 and make sure `opencode --version` works in a terminal.
2. Open a folder in VS Code.
3. Click the **OpenChat** icon in the Activity Bar (or run `OpenChat: Open Chat`, `Ctrl+Alt+O`).
4. Wait for the status to become *ready* and start chatting.

The extension starts its own OpenCode server per window (with a random local password). The **Output → OpenChat** channel shows the detected CLI version and any server logs.

## Commands

| Command | Description |
| --- | --- |
| `OpenChat: Open Chat` | Focus the chat panel (`Ctrl+Alt+O` / `Cmd+Alt+O`). |
| `OpenChat: New Session` | Start a new session. |
| `OpenChat: Ask About Selection` | Send the current selection as context. |
| `OpenChat: Add File to Chat` | Add the current file reference to the composer. |
| `OpenChat: Restart Server` | Restart the OpenCode server. |

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `openchat.opencodePath` | `opencode` | Path or command used to launch the OpenCode CLI. |
| `openchat.hostname` | `127.0.0.1` | Hostname of the OpenCode server. |
| `openchat.serverPort` | `0` | Port to use. `0` picks a random free port. |
| `openchat.reuseServer` | `true` | Try to reuse an existing OpenCode server before spawning a new one. |
| `openchat.model` | *(empty)* | Default model in `provider/model` format. Empty uses the OpenCode default. |
| `openchat.agent` | *(empty)* | Default agent. Empty uses the OpenCode default. |
| `openchat.includeSelectionText` | `true` | Attach the selected text, not only the file reference. |

## License

[MIT](LICENSE)
