import * as vscode from "vscode"
import { ServerManager, detectOpenCodeCli } from "./server/manager"
import { ChatController } from "./chat/controller"
import { ChatViewProvider } from "./webview/ChatViewProvider"
import { formatReference, getEditorContext } from "./context/editorContext"

let server: ServerManager | undefined
let controller: ChatController | undefined

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const output = vscode.window.createOutputChannel("OpenChat")
  context.subscriptions.push(output)

  const provider = new ChatViewProvider(context)
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  )

  const startServer = async (): Promise<void> => {
    provider.setStatus("starting", "Starting OpenCode server…")
    const cfg = vscode.workspace.getConfiguration("openchat")
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
    const opencodePath = cfg.get<string>("opencodePath", "opencode")

    const cli = await detectOpenCodeCli(opencodePath, cwd)
    if (!cli.installed) {
      const msg =
        `OpenCode CLI not found using "${opencodePath}". ` +
        `Install it (e.g. "npm i -g @opencode/cli") or set "openchat.opencodePath".`
      output.appendLine(`[cli] ${cli.error ?? "not found"}`)
      provider.setStatus("error", msg)
      void vscode.window.showErrorMessage(`OpenChat: ${msg}`)
      return
    }
    if (cli.major !== undefined && cli.major < 2) {
      const msg =
        `OpenCode ${cli.raw || `v${cli.version}`} is not supported. ` +
        `This extension requires OpenCode v2 (the v1 HTTP API is gone).`
      output.appendLine(`[cli] detected ${cli.raw}`)
      provider.setStatus("error", msg)
      void vscode.window.showWarningMessage(`OpenChat: ${msg}`)
      return
    }
    if (cli.raw) output.appendLine(`[cli] ${cli.raw}`)

    try {
      server = new ServerManager()
      await server.start({
        hostname: cfg.get<string>("hostname", "127.0.0.1"),
        port: cfg.get<number>("serverPort", 0),
        reuse: cfg.get<boolean>("reuseServer", true),
        opencodePath,
        cwd,
      })

      controller?.dispose()
      controller = new ChatController(server.api, {
        includeSelectionText: cfg.get<boolean>("includeSelectionText", true),
        directory: cwd ?? process.cwd(),
        output,
      })
      provider.setController(controller)
      provider.setStatus("ready")

      await controller.init({
        model: cfg.get<string>("model", ""),
        agent: cfg.get<string>("agent", ""),
        context: getEditorContext(),
      })
    } catch (err: any) {
      output.appendLine(String(err?.stack ?? err))
      provider.setStatus("error", String(err?.message ?? err))
    }
  }

  context.subscriptions.push(
    vscode.commands.registerCommand("openchat.openChat", () => provider.focus()),
    vscode.commands.registerCommand("openchat.newSession", () => {
      provider.focus()
      void controller?.newSession()
    }),
    vscode.commands.registerCommand("openchat.askSelection", () => {
      const ctx = getEditorContext()
      if (!ctx) {
        void vscode.window.showInformationMessage("OpenCode: open a file inside the workspace first.")
        return
      }
      provider.focus()
      provider.prefill(`Explain this code:\n\n${formatReference(ctx)}\n`)
    }),
    vscode.commands.registerCommand("openchat.addFileToChat", () => {
      const ctx = getEditorContext()
      if (!ctx) {
        void vscode.window.showInformationMessage("OpenCode: open a file inside the workspace first.")
        return
      }
      provider.focus()
      provider.prefill(formatReference(ctx) + " ")
    }),
    vscode.commands.registerCommand("openchat.restartServer", async () => {
      server?.stop()
      await startServer()
    }),
  )

  const onContextChange = (): void => provider.setContext(getEditorContext())
  let timer: NodeJS.Timeout | undefined
  const debounced = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(onContextChange, 150)
  }

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(debounced),
    vscode.window.onDidChangeTextEditorSelection(debounced),
    { dispose: () => controller?.dispose() },
    { dispose: () => server?.stop() },
  )

  await startServer()
}

export function deactivate(): void {
  controller?.dispose()
  server?.stop()
}
