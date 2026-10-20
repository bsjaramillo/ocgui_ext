import * as vscode from "vscode"
import type { ChatController } from "../chat/controller"
import type {
  Attachment,
  ClientMessage,
  EditorContext,
  FileDiffInfo,
  ServerMessage,
  ServerStatus,
} from "../protocol"
import { toAttachment } from "../context/attachments"

class DiffContentProvider implements vscode.TextDocumentContentProvider {
  private readonly store = new Map<string, string>()

  set(key: string, content: string): void {
    this.store.set(key, content)
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.store.get(uri.path) ?? ""
  }
}

export class ChatViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = "openchat.chatView"

  private view?: vscode.WebviewView
  private controller?: ChatController
  private status: ServerStatus = "starting"
  private statusMessage?: string
  private lastInit?: ServerMessage
  private lastContext?: EditorContext
  private lastDiffs: FileDiffInfo[] = []
  private readonly diffProvider = new DiffContentProvider()

  constructor(private readonly context: vscode.ExtensionContext) {
    context.subscriptions.push(
      vscode.workspace.registerTextDocumentContentProvider("openchat-diff", this.diffProvider),
    )
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri],
    }
    view.webview.html = this.getHtml(view.webview)

    view.webview.onDidReceiveMessage((msg: ClientMessage) => this.onClientMessage(msg))
    view.onDidDispose(() => {
      this.view = undefined
    })

    this.post({ type: "status", status: this.status, message: this.statusMessage })
    if (this.lastContext) this.post({ type: "context", context: this.lastContext })
    if (this.status === "ready" && this.lastInit) this.post(this.lastInit)
    this.post({ type: "diffs", diffs: this.lastDiffs })
  }

  setController(controller: ChatController): void {
    this.controller = controller
    controller.onMessage((msg) => {
      if (msg.type === "init") this.lastInit = msg
      if (msg.type === "diffs") this.lastDiffs = msg.diffs
      this.post(msg)
    })
  }

  setStatus(status: ServerStatus, message?: string): void {
    this.status = status
    this.statusMessage = message
    this.post({ type: "status", status, message })
  }

  setContext(context?: EditorContext): void {
    this.lastContext = context
    this.post({ type: "context", context })
  }

  focus(): void {
    void vscode.commands.executeCommand("openchat.chatView.focus")
  }

  prefill(text: string): void {
    this.post({ type: "prefill", text })
  }

  private post(msg: ServerMessage): void {
    void this.view?.webview.postMessage(msg)
  }

  private onClientMessage(msg: ClientMessage): void {
    switch (msg.type) {
      case "ready":
        this.post({ type: "status", status: this.status, message: this.statusMessage })
        if (this.lastContext) this.post({ type: "context", context: this.lastContext })
        if (this.status === "ready" && this.lastInit) this.post(this.lastInit)
        this.post({ type: "diffs", diffs: this.lastDiffs })
        break
      case "send":
        void this.controller?.sendPrompt(
          msg.text,
          msg.includeContext ? this.lastContext : undefined,
          msg.files,
        )
        break
      case "pickFiles":
        void this.pickFiles()
        break
      case "abort":
        void this.controller?.abort()
        break
      case "newSession":
        void this.controller?.newSession()
        break
      case "switchSession":
        void this.controller?.switchSession(msg.sessionId)
        break
      case "deleteSession":
        void this.controller?.deleteSession(msg.sessionId)
        break
      case "renameSession":
        void this.renameSession(msg.sessionId, msg.currentTitle)
        break
      case "refreshDiffs":
        void this.controller?.refreshDiffs()
        break
      case "openDiff":
        void this.openDiff(msg.file)
        break
      case "revert":
        void this.controller?.revert(msg.messageId)
        break
      case "unrevert":
        void this.controller?.unrevert()
        break
      case "permission":
        void this.controller?.respondPermission(msg.permissionId, msg.response)
        break
      case "setModel":
        this.controller?.setModel(msg.model)
        break
      case "setAgent":
        this.controller?.setAgent(msg.agent)
        break
      case "insertCode":
        this.insertCode(msg.text)
        break
      case "openFile":
        void this.openFile(msg.path, msg.line)
        break
      case "restart":
        void vscode.commands.executeCommand("openchat.restartServer")
        break
    }
  }

  private async renameSession(sessionId: string, currentTitle?: string): Promise<void> {
    const title = await vscode.window.showInputBox({
      prompt: "Session title",
      placeHolder: "New session title",
      value: currentTitle ?? "",
    })
    if (title === undefined) return
    await this.controller?.renameSession(sessionId, title)
  }

  private async pickFiles(): Promise<void> {
    const folders = vscode.workspace.workspaceFolders
    const defaultUri = folders && folders.length > 0 ? folders[0].uri : undefined
    const uris = await vscode.window.showOpenDialog({
      canSelectMany: true,
      canSelectFiles: true,
      canSelectFolders: false,
      openLabel: "Attach",
      defaultUri,
    })
    if (!uris || uris.length === 0) return
    const files: Attachment[] = uris.filter((u) => u.scheme === "file").map((u) => toAttachment(u))
    if (files.length > 0) this.post({ type: "attachments", files })
  }

  private async insertCode(text: string): Promise<void> {
    const editor = vscode.window.activeTextEditor
    if (!editor) {
      await vscode.env.clipboard.writeText(text)
      void vscode.window.showInformationMessage("OpenCode: copied to clipboard (no active editor).")
      return
    }
    await editor.edit((builder) => builder.insert(editor.selection.active, text))
  }

  private async openFile(path: string, line?: number): Promise<void> {
    const folders = vscode.workspace.workspaceFolders
    if (!folders || folders.length === 0) return
    const uri = vscode.Uri.joinPath(folders[0].uri, path)
    try {
      const doc = await vscode.workspace.openTextDocument(uri)
      const editor = await vscode.window.showTextDocument(doc)
      if (line && line > 0) {
        const pos = new vscode.Position(line - 1, 0)
        editor.selection = new vscode.Selection(pos, pos)
        editor.revealRange(new vscode.Range(pos, pos))
      }
    } catch {
      // ignore missing files
    }
  }

  private async openDiff(file: string): Promise<void> {
    const diff = this.lastDiffs.find((d) => d.file === file)
    if (!diff) return
    const id = file.replace(/[^a-zA-Z0-9._-]/g, "_") + "-" + Date.now()
    const left = vscode.Uri.parse(`openchat-diff:/${id}/before`)
    const right = vscode.Uri.parse(`openchat-diff:/${id}/after`)
    this.diffProvider.set(left.path, diff.before)
    this.diffProvider.set(right.path, diff.after)
    await vscode.commands.executeCommand("vscode.diff", left, right, `${file} (OpenCode)`)
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce()
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "media", "chat.js"),
    )
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "media", "chat.css"),
    )
    const csp = [
      "default-src 'none'",
      `img-src ${webview.cspSource} https: data:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
      `font-src ${webview.cspSource}`,
    ].join("; ")

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link href="${styleUri}" rel="stylesheet" />
  <title>OpenChat</title>
</head>
<body>
  <div id="app">
    <header id="toolbar">
      <div class="row">
        <select id="session-select" title="Session"></select>
        <button id="new-session" class="icon-btn" title="New session">+</button>
        <button id="rename-session" class="icon-btn" title="Rename session">&#9998;</button>
        <button id="delete-session" class="icon-btn" title="Delete session">&#128465;</button>
        <button id="restart" class="icon-btn" title="Restart server">&#8635;</button>
      </div>
      <div class="row">
        <select id="agent-select" title="Agent"></select>
        <select id="model-select" title="Model"></select>
      </div>
      <div class="row usage-row">
        <span id="usage" title="Session usage">—</span>
        <button id="thinking-toggle" class="text-btn" title="Show or hide the model's thinking">Thinking</button>
        <button id="changes-toggle" class="text-btn" title="Toggle changed files">Changes <span id="changes-count">0</span></button>
      </div>
    </header>

    <div id="context-bar" class="hidden">
      <label class="ctx-toggle">
        <input type="checkbox" id="include-context" checked />
        <span id="context-label">No context</span>
      </label>
    </div>

    <div id="changes" class="hidden">
      <div class="changes-head">
        <span>Changed files</span>
        <span>
          <button id="changes-refresh" class="icon-btn" title="Refresh">&#8635;</button>
          <button id="unrevert" class="text-btn" title="Restore reverted messages">Restore</button>
        </span>
      </div>
      <div id="changes-list"></div>
    </div>

    <main id="messages"></main>

    <div id="thinking" class="hidden">
      <span class="spinner"></span>
      <span id="thinking-label">OpenCode is thinking…</span>
    </div>

    <div id="status" class="hidden"></div>

    <footer id="composer">
      <div id="attachments" class="hidden"></div>
      <textarea id="input" rows="3" placeholder="Ask OpenCode… (Enter to send, Shift+Enter for newline)"></textarea>
      <div class="composer-actions">
        <button id="attach" class="icon-btn" title="Attach files">&#128206;</button>
        <button id="send">Send</button>
        <button id="stop" class="hidden">Stop</button>
      </div>
    </footer>
  </div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`
  }
}

function getNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
  let nonce = ""
  for (let i = 0; i < 32; i++) nonce += chars.charAt(Math.floor(Math.random() * chars.length))
  return nonce
}
