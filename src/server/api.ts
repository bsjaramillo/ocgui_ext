import * as http from "node:http"

export interface AgentInfo {
  id: string
  name: string
  mode?: string
  hidden?: boolean
  description?: string
}

export interface ModelInfo {
  id: string
  modelID: string
  providerID: string
  name: string
  limit?: { context?: number; output?: number; input?: number }
  capabilities?: { input?: string[]; output?: string[]; tools?: boolean }
  variants?: Array<{ id: string }>
  status?: string
  enabled?: boolean
}

export interface ProviderInfo {
  id: string
  name: string
}

export interface ModelRef {
  id: string
  providerID: string
  variant?: string
}

export interface SessionInfo {
  id: string
  title?: string
  agent?: string
  model?: ModelRef
  time?: { created?: number; updated?: number }
}

export interface FileAttachmentInput {
  uri: string
  name?: string
  description?: string
}

export interface FileDiff {
  file: string
  patch?: string
  additions: number
  deletions: number
  status?: string
}

export interface ApiEvent {
  id?: string
  type: string
  created?: number
  data?: any
  location?: { directory?: string }
  durable?: { aggregateID?: string; seq?: number; version?: number }
}

interface RequestOptions {
  query?: Record<string, string | number | undefined>
  body?: unknown
}

interface HttpResponse {
  status: number
  text: string
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = "ApiError"
  }
}

function httpRequest(opts: {
  method: string
  url: string
  headers: Record<string, string>
  body?: string
  signal?: AbortSignal
  timeoutMs?: number
}): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const url = new URL(opts.url)
    const req = http.request(
      {
        method: opts.method,
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        headers: opts.headers,
        signal: opts.signal,
      },
      (res) => {
        let data = ""
        res.setEncoding("utf8")
        res.on("data", (chunk) => (data += chunk))
        res.on("end", () => resolve({ status: res.statusCode ?? 0, text: data }))
        res.on("error", reject)
      },
    )
    req.setTimeout(opts.timeoutMs ?? 15000, () => {
      req.destroy(new Error("Request timed out"))
    })
    req.on("error", reject)
    if (opts.body !== undefined) req.write(opts.body)
    req.end()
  })
}

export class OpenCodeApi {
  private readonly baseUrl: string
  private readonly headers: Record<string, string>

  constructor(opts: { baseUrl: string; password?: string }) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "")
    this.headers = { Accept: "application/json" }
    if (opts.password) {
      this.headers.Authorization = `Basic ${Buffer.from(`opencode:${opts.password}`).toString("base64")}`
    }
  }

  private buildUrl(path: string, query?: RequestOptions["query"]): string {
    const url = new URL(this.baseUrl + path)
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value))
    }
    return url.toString()
  }

  private async request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
    const headers: Record<string, string> = { ...this.headers }
    let body: string | undefined
    if (opts.body !== undefined) {
      headers["Content-Type"] = "application/json"
      body = JSON.stringify(opts.body)
    }
    const res = await httpRequest({
      method,
      url: this.buildUrl(path, opts.query),
      headers,
      body,
    })
    if (res.status < 200 || res.status >= 300) {
      throw new ApiError(res.status, this.describeError(res.status, res.text))
    }
    if (!res.text) return undefined as T
    try {
      return JSON.parse(res.text) as T
    } catch {
      throw new ApiError(res.status, "OpenCode server returned an unexpected response")
    }
  }

  private describeError(status: number, text: string): string {
    if (status === 401) return "Authentication required (server password mismatch)."
    try {
      const parsed = JSON.parse(text)
      const message = parsed?.message ?? parsed?.data?.message ?? parsed?._tag
      if (message) return String(message)
    } catch {
      // not JSON
    }
    if (text.startsWith("<!doctype") || text.startsWith("<html")) {
      return `Request is not supported by this OpenCode server (HTTP ${status}).`
    }
    return text.slice(0, 300) || `HTTP ${status}`
  }

  // ---- agents / models / providers ----

  async listAgents(directory: string): Promise<AgentInfo[]> {
    const res = await this.request<{ data: AgentInfo[] }>("GET", "/api/agent", {
      query: { "location[directory]": directory },
    })
    return res.data ?? []
  }

  async listModels(directory: string): Promise<ModelInfo[]> {
    const res = await this.request<{ data: ModelInfo[] }>("GET", "/api/model", {
      query: { "location[directory]": directory },
    })
    return res.data ?? []
  }

  async defaultModel(directory: string): Promise<ModelRef | undefined> {
    const res = await this.request<{ data: ModelInfo | null }>("GET", "/api/model/default", {
      query: { "location[directory]": directory },
    })
    if (!res.data) return undefined
    return { id: res.data.modelID ?? res.data.id, providerID: res.data.providerID }
  }

  // ---- sessions ----

  async listSessions(directory?: string, limit = 50): Promise<SessionInfo[]> {
    const res = await this.request<{ data: SessionInfo[] }>("GET", "/api/session", {
      query: { limit, order: "desc", directory },
    })
    return res.data ?? []
  }

  async updateSession(sessionID: string, title: string): Promise<void> {
    await this.request<void>("PATCH", `/api/session/${encodeURIComponent(sessionID)}`, {
      body: { title },
    })
  }

  async createSession(opts: {
    directory: string
    title?: string
    agent?: string
    model?: ModelRef
  }): Promise<SessionInfo | undefined> {
    const res = await this.request<{ data: SessionInfo }>("POST", "/api/session", {
      body: {
        title: opts.title,
        agent: opts.agent,
        model: opts.model,
        location: { directory: opts.directory },
      },
    })
    return res.data
  }

  async deleteSession(sessionID: string): Promise<void> {
    await this.request<void>("DELETE", `/api/session/${encodeURIComponent(sessionID)}`)
  }

  async getSession(sessionID: string): Promise<SessionInfo | undefined> {
    const res = await this.request<{ data: SessionInfo }>(
      "GET",
      `/api/session/${encodeURIComponent(sessionID)}`,
    )
    return res.data
  }

  async listMessages(sessionID: string, limit = 200): Promise<any[]> {
    // The server caps `limit` at 200 and `order=asc` returns the OLDEST page,
    // which hides new messages in long sessions. Fetch the NEWEST page instead
    // and reverse it so callers still get oldest -> newest.
    const res = await this.request<{ data: any[] }>(
      "GET",
      `/api/session/${encodeURIComponent(sessionID)}/message`,
      { query: { order: "desc", limit } },
    )
    return (res.data ?? []).slice().reverse()
  }

  async prompt(
    sessionID: string,
    input: { text: string; files?: FileAttachmentInput[] },
  ): Promise<void> {
    await this.request("POST", `/api/session/${encodeURIComponent(sessionID)}/prompt`, {
      body: { text: input.text, files: input.files },
    })
  }

  async interrupt(sessionID: string): Promise<void> {
    await this.request<void>("POST", `/api/session/${encodeURIComponent(sessionID)}/interrupt`)
  }

  async switchAgent(sessionID: string, agent: string): Promise<void> {
    await this.request<void>("POST", `/api/session/${encodeURIComponent(sessionID)}/agent`, {
      body: { agent },
    })
  }

  async switchModel(sessionID: string, model: ModelRef): Promise<void> {
    await this.request<void>("POST", `/api/session/${encodeURIComponent(sessionID)}/model`, {
      body: { model },
    })
  }

  async diff(sessionID: string): Promise<FileDiff[]> {
    const res = await this.request<{ data: FileDiff[] }>(
      "GET",
      `/api/session/${encodeURIComponent(sessionID)}/diff`,
    )
    return res.data ?? []
  }

  async revertStage(sessionID: string, messageID: string): Promise<void> {
    await this.request<void>("POST", `/api/session/${encodeURIComponent(sessionID)}/revert/stage`, {
      body: { messageID },
    })
  }

  async revertClear(sessionID: string): Promise<void> {
    await this.request<void>("DELETE", `/api/session/${encodeURIComponent(sessionID)}/revert`)
  }

  async revertCommit(sessionID: string): Promise<void> {
    await this.request<void>("POST", `/api/session/${encodeURIComponent(sessionID)}/revert/commit`)
  }

  async replyPermission(
    sessionID: string,
    requestID: string,
    decision: "once" | "always" | "reject",
  ): Promise<void> {
    await this.request<void>(
      "POST",
      `/api/session/${encodeURIComponent(sessionID)}/permission/${encodeURIComponent(requestID)}/reply`,
      { body: { decision } },
    )
  }

  async probe(): Promise<{ ok: boolean; detail: string }> {
    try {
      await this.request("GET", "/api/session", { query: { limit: 1 } })
      return { ok: true, detail: "ok" }
    } catch (err: any) {
      if (err instanceof ApiError) return { ok: false, detail: `HTTP ${err.status}: ${err.message}` }
      return { ok: false, detail: String(err?.message ?? err) }
    }
  }

  async ready(): Promise<boolean> {
    return (await this.probe()).ok
  }

  async subscribe(onEvent: (event: ApiEvent) => void, signal: AbortSignal): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const url = new URL(`${this.baseUrl}/api/event`)
      const req = http.request(
        {
          method: "GET",
          hostname: url.hostname,
          port: url.port,
          path: url.pathname + url.search,
          headers: { ...this.headers, Accept: "text/event-stream" },
          signal,
        },
        (res) => {
          if ((res.statusCode ?? 0) !== 200) {
            res.resume()
            reject(new ApiError(res.statusCode ?? 0, `Event stream failed (HTTP ${res.statusCode})`))
            return
          }
          let buffer = ""
          res.setEncoding("utf8")
          res.on("data", (chunk: string) => {
            buffer += chunk
            let index: number
            while ((index = buffer.indexOf("\n")) >= 0) {
              const line = buffer.slice(0, index).trim()
              buffer = buffer.slice(index + 1)
              if (!line.startsWith("data:")) continue
              const payload = line.slice(5).trim()
              if (!payload) continue
              try {
                onEvent(JSON.parse(payload) as ApiEvent)
              } catch {
                // ignore malformed payloads
              }
            }
          })
          res.on("end", () => resolve())
          res.on("error", reject)
        },
      )
      req.setTimeout(90000, () => req.destroy(new Error("event stream idle timeout")))
      req.on("error", (err) => {
        if (signal.aborted) resolve()
        else reject(err)
      })
      req.end()
    })
  }
}
