import * as vscode from "vscode"
import type { OpenCodeApi, ApiEvent, ModelRef } from "../server/api"
import type {
  Attachment,
  ChatMessage,
  EditorContext,
  FileDiffInfo,
  ModelOption,
  ServerMessage,
  SessionSummary,
} from "../protocol"
import { formatReference } from "../context/editorContext"

export interface ControllerOptions {
  includeSelectionText: boolean
  directory: string
  output: vscode.OutputChannel
}

export interface InitOptions {
  model?: string
  agent?: string
  context?: EditorContext
}

export class ChatController {
  private readonly emitter = new vscode.EventEmitter<ServerMessage>()
  readonly onMessage = this.emitter.event

  private readonly abortController = new AbortController()
  private sessionId: string | null = null
  private busy = false
  private model?: string
  private agent?: string
  private reloadTimer?: NodeJS.Timeout

  constructor(
    private readonly api: OpenCodeApi,
    private readonly options: ControllerOptions,
  ) {}

  dispose(): void {
    this.abortController.abort()
    if (this.reloadTimer) clearTimeout(this.reloadTimer)
    this.emitter.dispose()
  }

  async init(opts: InitOptions): Promise<void> {
    this.model = opts.model || undefined
    this.agent = opts.agent || undefined

    const agents = await this.loadAgents()
    const models = await this.loadModels()
    const sessions = await this.loadSessions()
    const discovered = await this.loadDefaultModel()
    this.model = opts.model || discovered || undefined

    const existing = sessions[0]?.id ?? null
    let sessionId: string | null = existing
    if (!existing) {
      const created = await this.createSession()
      if (created) {
        sessionId = created
        sessions.unshift({ id: created, title: "New session", updated: Date.now() })
      }
    }
    this.sessionId = sessionId

    const messages = sessionId ? await this.loadMessages(sessionId) : []

    this.log(
      `[init] directory=${this.options.directory} agents=${agents.length} models=${models.length} ` +
        `sessions=${sessions.length} sessionId=${sessionId ?? "none"} model=${this.model ?? "default"}`,
    )

    this.emit({
      type: "init",
      sessionId,
      sessions,
      agents,
      models,
      messages,
      context: opts.context,
      model: this.model,
      agent: this.agent,
    })

    await this.loadDiffs()
    void this.subscribe()
  }

  async sendPrompt(text: string, context?: EditorContext, attachments?: Attachment[]): Promise<void> {
    if (!this.sessionId) {
      const created = await this.createSession()
      if (!created) {
        this.emit({
          type: "error",
          message: "No active session. Check the Output → OpenChat channel, then use “New Session”.",
        })
        return
      }
      this.sessionId = created
      const sessions = await this.loadSessions()
      this.emit({ type: "session", sessionId: created, messages: [], sessions })
    }
    const files = (attachments ?? []).map((a) => ({ uri: a.url, name: a.filename }))
    this.log(`[prompt] session=${this.sessionId} chars=${text.length} files=${files.length}`)
    this.setBusy(true)
    try {
      await this.api.prompt(this.sessionId, { text: this.buildPrompt(text, context), files })
      this.log("[prompt] accepted")
      await this.reloadMessages()
    } catch (err: any) {
      this.log(`[prompt] failed: ${String(err?.message ?? err)}`)
      this.emit({ type: "error", message: this.errorMessage(err) })
      this.setBusy(false)
    } finally {
      await this.loadDiffs()
    }
  }

  async abort(): Promise<void> {
    if (!this.sessionId) return
    try {
      await this.api.interrupt(this.sessionId)
    } catch {
      // ignore
    }
    this.setBusy(false)
  }

  async newSession(): Promise<void> {
    const id = await this.createSession()
    if (!id) return
    this.sessionId = id
    const sessions = await this.loadSessions()
    this.emit({ type: "session", sessionId: id, messages: [], sessions })
    await this.loadDiffs()
  }

  async switchSession(id: string): Promise<void> {
    this.sessionId = id
    const messages = await this.loadMessages(id)
    const sessions = await this.loadSessions()
    this.emit({ type: "session", sessionId: id, messages, sessions })
    await this.loadDiffs()
  }

  async deleteSession(id: string): Promise<void> {
    try {
      await this.api.deleteSession(id)
    } catch (err: any) {
      this.emit({ type: "error", message: this.errorMessage(err) })
      return
    }
    const sessions = await this.loadSessions()
    if (id === this.sessionId) {
      const next = sessions[0]?.id ?? null
      this.sessionId = next
      const messages = next ? await this.loadMessages(next) : []
      this.emit({ type: "session", sessionId: next, messages, sessions })
      await this.loadDiffs()
    } else {
      this.emit({ type: "sessions", sessions })
    }
  }

  async renameSession(id: string, title: string): Promise<void> {
    const trimmed = title.trim()
    if (!trimmed) return
    try {
      await this.api.updateSession(id, trimmed)
    } catch (err: any) {
      this.emit({ type: "error", message: this.errorMessage(err) })
      return
    }
    const sessions = await this.loadSessions()
    this.emit({ type: "sessions", sessions })
  }

  async revert(messageId: string): Promise<void> {
    if (!this.sessionId) return
    try {
      await this.api.revertStage(this.sessionId, messageId)
    } catch (err: any) {
      this.emit({ type: "error", message: this.errorMessage(err) })
      return
    }
    await this.reloadMessages()
    await this.loadDiffs()
  }

  async unrevert(): Promise<void> {
    if (!this.sessionId) return
    try {
      await this.api.revertClear(this.sessionId)
    } catch (err: any) {
      this.emit({ type: "error", message: this.errorMessage(err) })
      return
    }
    await this.reloadMessages()
    await this.loadDiffs()
  }

  async refreshDiffs(): Promise<void> {
    await this.loadDiffs()
  }

  async respondPermission(
    permissionId: string,
    response: "once" | "always" | "reject",
  ): Promise<void> {
    if (!this.sessionId) return
    try {
      await this.api.replyPermission(this.sessionId, permissionId, response)
    } catch (err: any) {
      this.emit({ type: "error", message: String(err?.message ?? err) })
    }
  }

  setModel(model: string): void {
    this.model = model || undefined
    const ref = this.parseModel()
    if (ref && this.sessionId) {
      void this.api.switchModel(this.sessionId, ref).catch(() => undefined)
    }
  }

  setAgent(agent: string): void {
    this.agent = agent || undefined
    if (agent && this.sessionId) {
      void this.api.switchAgent(this.sessionId, agent).catch(() => undefined)
    }
  }

  private buildPrompt(text: string, context?: EditorContext): string {
    if (!context) return text
    let body = `${text}\n\n${formatReference(context)}`
    if (this.options.includeSelectionText && context.hasSelection && context.selectedText.trim()) {
      body += `\n\n\`\`\`${context.languageId}\n${context.selectedText}\n\`\`\``
    }
    return body
  }

  private parseModel(): ModelRef | undefined {
    if (!this.model) return undefined
    const idx = this.model.indexOf("/")
    if (idx <= 0) return undefined
    return { providerID: this.model.slice(0, idx), id: this.model.slice(idx + 1) }
  }

  private async loadAgents(): Promise<string[]> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const agents = await this.api.listAgents(this.options.directory)
        if (agents.length > 0) {
          return agents.filter((a) => a.mode !== "subagent").map((a) => a.id)
        }
      } catch {
        // ignore and retry
      }
      if (attempt < 2) await new Promise((r) => setTimeout(r, 600))
    }
    return []
  }

  private async loadModels(): Promise<ModelOption[]> {
    try {
      const models = await this.api.listModels(this.options.directory)
      return models.map((m) => ({
        id: `${m.providerID}/${m.modelID}`,
        name: m.name,
        providerID: m.providerID,
        modelID: m.modelID,
        context: m.limit?.context,
      }))
    } catch {
      return []
    }
  }

  private async loadDefaultModel(): Promise<string | undefined> {
    try {
      const model = await this.api.defaultModel(this.options.directory)
      return model ? `${model.providerID}/${model.id}` : undefined
    } catch {
      return undefined
    }
  }

  private async loadSessions(): Promise<SessionSummary[]> {
    try {
      const sessions = await this.api.listSessions(this.options.directory)
      return sessions.map((s) => ({
        id: s.id,
        title: s.title ?? "Untitled",
        updated: s.time?.updated ?? 0,
      }))
    } catch {
      return []
    }
  }

  private async createSession(): Promise<string | null> {
    try {
      const session = await this.api.createSession({
        directory: this.options.directory,
        title: "OpenCode GUI",
        agent: this.agent,
        model: this.parseModel(),
      })
      this.log(`[session] created ${session?.id ?? "none"}`)
      return session?.id ?? null
    } catch (err: any) {
      this.log(`[session] create failed: ${String(err?.message ?? err)}`)
      this.emit({ type: "error", message: String(err?.message ?? err) })
      return null
    }
  }

  private async loadMessages(id: string): Promise<ChatMessage[]> {
    try {
      const raw = await this.api.listMessages(id)
      return raw.map(mapMessage).filter((m): m is ChatMessage => m !== null)
    } catch {
      return []
    }
  }

  private async reloadMessages(): Promise<void> {
    if (!this.sessionId) return
    const messages = await this.loadMessages(this.sessionId)
    this.emit({ type: "messages", messages })
  }

  private async loadDiffs(): Promise<void> {
    if (!this.sessionId) {
      this.emit({ type: "diffs", diffs: [] })
      return
    }
    try {
      const diffs = await this.api.diff(this.sessionId)
      this.emit({
        type: "diffs",
        diffs: diffs.map((d) => ({
          file: d.file,
          before: "",
          after: d.patch ?? "",
          additions: d.additions ?? 0,
          deletions: d.deletions ?? 0,
        })),
      })
    } catch {
      this.emit({ type: "diffs", diffs: [] })
    }
  }

  private scheduleReload(): void {
    if (this.reloadTimer) return
    this.reloadTimer = setTimeout(() => {
      this.reloadTimer = undefined
      void this.reloadMessages()
    }, 120)
  }

  private async subscribe(): Promise<void> {
    while (!this.abortController.signal.aborted) {
      try {
        this.log("[events] connected")
        await this.api.subscribe((event) => this.handleEvent(event), this.abortController.signal)
        if (!this.abortController.signal.aborted) this.log("[events] stream ended, reconnecting…")
      } catch (err: any) {
        if (this.abortController.signal.aborted) return
        this.log(`[events] error: ${String(err?.message ?? err)}`)
      }
      if (this.abortController.signal.aborted) return
      await new Promise((r) => setTimeout(r, 1500))
    }
  }

  private handleEvent(event: ApiEvent): void {
    const type = event.type
    const data = event.data ?? {}
    const sessionID: string | undefined = data.sessionID ?? event.durable?.aggregateID

    if (sessionID && this.sessionId && sessionID !== this.sessionId) return

    if (type === "session.execution.started" || type === "session.step.started") {
      this.setBusy(true)
    } else if (
      type === "session.execution.succeeded" ||
      type === "session.execution.failed" ||
      type === "session.execution.interrupted"
    ) {
      this.setBusy(false)
      void this.loadDiffs()
    }

    if (data.error) {
      this.emit({ type: "error", message: this.errorMessage(data.error) })
      this.setBusy(false)
    }

    if (type === "permission.asked" || type === "permission.v2.asked") {
      const permission = data.permission ?? data
      const id = permission.id ?? data.requestID ?? data.permissionID
      if (id) {
        this.emit({
          type: "event",
          event: {
            type: "permission.updated",
            properties: { id, title: permission.title ?? permission.action ?? "Permission requested" },
          },
        })
      }
    } else if (type === "permission.replied" || type === "permission.v2.replied") {
      const id = data.permissionID ?? data.requestID ?? data.id
      if (id) {
        this.emit({ type: "event", event: { type: "permission.replied", properties: { permissionID: id } } })
      }
    }

    if (sessionID) this.scheduleReload()
  }

  private setBusy(busy: boolean): void {
    if (this.busy === busy) return
    this.busy = busy
    this.emit({ type: "busy", busy })
  }

  private log(message: string): void {
    this.options.output.appendLine(message)
  }

  private emit(msg: ServerMessage): void {
    this.emitter.fire(msg)
  }

  private stringify(value: unknown): string {
    if (typeof value === "string") return value
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }

  private errorMessage(err: any): string {
    if (!err) return "Unknown error"
    if (typeof err === "string") return err
    const inner = err.error ?? err
    const data = err.data ?? inner?.data
    const name = err.name ?? inner?.name
    const message = data?.message ?? err.message ?? inner?.message
    if (message) {
      const base = name && name !== "UnknownError" ? `${name}: ${message}` : message
      if (/subscription|Go models/i.test(String(message))) {
        return `${base}\n\nTip: pick another model in the dropdown (e.g. one ending in "-free") or set "openchat.model".`
      }
      return base
    }
    return this.stringify(err)
  }
}

function mapMessage(m: any): ChatMessage | null {
  if (!m || typeof m.type !== "string") return null
  if (m.type === "user") {
    const parts: any[] = []
    if (m.text) parts.push({ type: "text", text: m.text })
    for (const f of m.files ?? []) {
      parts.push({ type: "file", filename: f.name ?? f.source?.text ?? "file" })
    }
    return { info: { id: m.id, role: "user", time: m.time }, parts }
  }
  if (m.type === "assistant") {
    const parts = (m.content ?? [])
      .map((c: any) => {
        if (c.type === "text") return { type: "text", text: c.text }
        if (c.type === "reasoning") return { type: "reasoning", text: c.text }
        if (c.type === "tool") return { type: "tool", id: c.id, tool: c.name, state: c.state }
        return null
      })
      .filter(Boolean)
    return {
      info: {
        id: m.id,
        role: "assistant",
        cost: m.cost,
        tokens: m.tokens,
        modelID: m.model?.id,
        time: m.time,
        error: m.error,
      },
      parts,
    }
  }
  return null
}
